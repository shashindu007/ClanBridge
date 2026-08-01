-- T3.3 — Player verification: link a verified Clash of Clans account to a user.
--
-- WHY THIS IS A FUNCTION AND NOT A POLICY
--
-- `players` has exactly one policy — "read own clan players" (006) — and exactly
-- one grant: select. 015 handed `insert, update` to authenticated on clans,
-- clan_roles and users, and deliberately not on players. That is correct and
-- stays correct: players is a GAME FACT table (R11), owned by scripts/sync/, and
-- a session must never be able to write a player's name, clan or town hall.
--
-- But verification has to write two columns of it. So the write happens here, in
-- a security definer function that is the ONLY path, rather than by opening the
-- table up with an update policy and trusting a WITH CHECK expression to keep a
-- session away from the other columns.
--
-- This is the same reasoning 015 records at lines 199-207 for approve_account(),
-- and the same shape: authority check, then the write, then audit_log, all in one
-- indivisible act that cannot be half-performed.
--
-- R8 — the member's in-game API token never reaches this file. It is verified
-- against Supercell in /api/verify and discarded there. Nothing about it is a
-- parameter here; by the time this runs, ownership is already proven.


-- ---------------------------------------------------------------------------
-- link_verified_player(p_tag)
--
-- Called by /api/verify AFTER Supercell's verifytoken endpoint returned ok.
--
-- Returns jsonb rather than boolean because the caller needs to tell three
-- different outcomes apart in the UI, and a bare false cannot:
--
--   {"ok": true,  "player_id": …, "clan_id": …}
--   {"ok": false, "reason": "no_session"}
--   {"ok": false, "reason": "not_a_member"}
--
-- A tag that belongs to no clan on this platform is refused and NO player row is
-- invented for it. Two reasons:
--
--   1. R11 — players is written by sync jobs. A row created here would have no
--      clan, would never be updated by any job, and would sit in the table
--      looking like a member forever.
--   2. It is what makes T3.8's done-when true by construction: "an account
--      created with a random email and a stranger's verified tag can see no clan
--      data". Such a tag never links, so requested_clan_id stays null, so no
--      leader ever sees them in a queue, so they stay pending forever.
--
-- Manual leader approval is the confirmed policy for this deployment: verifying
-- a tag NEVER approves an account. It proves ownership and routes the applicant
-- to the right leader. Approval remains approve_account() (015), by a human.
-- ---------------------------------------------------------------------------
create or replace function link_verified_player(p_tag text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
  v_clan_id   uuid;
  v_owner     uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  if p_tag is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  -- clan_id is not null, so a player kept for history after leaving all three
  -- clans (T3.9 sets left_at) cannot be used to gain access. left_at is checked
  -- too: a departed member must be re-approved rather than walking back in.
  select id, clan_id, user_id
    into v_player_id, v_clan_id, v_owner
  from public.players
  where tag = p_tag
    and deleted_at is null
    and left_at is null
    and clan_id is not null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  -- Tag theft. The token proved the CALLER owns this game account, so a row
  -- already pointing at somebody else means either an account changed hands or
  -- an attempt to take over a teammate's profile. Neither is resolvable here —
  -- it raises so /api/verify can surface it and a leader can look into it.
  if v_owner is not null and v_owner <> auth.uid() then
    raise exception 'player already linked to another account';
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.players
  set verified = true,
      user_id  = auth.uid()
  where id = v_player_id;

  -- THIS is what puts the applicant in front of the right leader. 013's
  -- "leaders read pending applicants to their clans" policy filters on
  -- requested_clan_id, and the guard trigger below now refuses a direct write to
  -- it — so this function is the only way it can ever be set, and a member
  -- cannot nominate themselves into a clan they have no account in.
  update public.users
  set requested_clan_id = v_clan_id
  where id = auth.uid()
    and deleted_at is null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), v_clan_id, 'verify', 'players', v_player_id,
          jsonb_build_object('verified', true, 'tag', p_tag));

  return jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'clan_id', v_clan_id);
end;
$$;

revoke execute on function link_verified_player(text) from public;
grant execute on function link_verified_player(text) to authenticated;

comment on function link_verified_player(text) is
  'T3.3 - links a verified player tag to auth.uid() and routes the account to '
  'that clan''s leader for approval. The only write path to players from a '
  'session; players is otherwise select-only for authenticated (R11).';


-- ---------------------------------------------------------------------------
-- Close the requested_clan_id escalation.
--
-- 015 added "own profile update" so a member could set their own display name,
-- and guarded the two columns that were obviously dangerous: is_platform_admin
-- and status. requested_clan_id was not guarded, and it should have been.
--
-- Without this, any signed-in user can run
--
--     update users set requested_clan_id = '<any clan uuid>' where id = auth.uid()
--
-- and appear in that clan leader's pending-applicant list, having verified
-- nothing. It is not a data leak — 013's policy only exposes the applicant's own
-- row to the leader, and approval is still a deliberate human act — but it lets
-- a stranger put themselves in front of a leader who may click approve out of
-- habit. The whole point of the pending queue is that everything in it arrived
-- by proving something.
--
-- Now the only writer is link_verified_player() above, which sets it to the clan
-- the verified tag actually plays in.
--
-- This is a `create or replace` of 015's function; the trigger it backs
-- (users_guard_privilege_columns) is unchanged and stays attached.
-- ---------------------------------------------------------------------------
create or replace function guard_user_privilege_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Constrain END-USER SESSIONS only.
  --
  -- Deliberately an allow-list of the two untrusted roles rather than a
  -- deny-list of trusted ones. Everything else — service_role for sync jobs,
  -- postgres for migrations and admin tooling — is already privileged by other
  -- means, and an earlier version that tested `role = 'service_role'` blocked
  -- the migration runner itself.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- The definer functions set this transaction-locally before their update.
  -- Nothing else sets it, and each one checks the caller's authority first.
  if current_setting('clanbridge.bootstrap', true) = 'on' then
    return new;
  end if;

  if new.is_platform_admin is distinct from old.is_platform_admin then
    raise exception 'is_platform_admin cannot be set directly';
  end if;

  -- status is only ever changed by approve_account() / reject_account(), which
  -- set the bootstrap GUC above. A direct session write is always refused,
  -- including a member trying to approve themselves.
  if new.status is distinct from old.status then
    raise exception 'status is set by approve_account()/reject_account(), not directly';
  end if;

  -- New in 016. See the block comment above.
  if new.requested_clan_id is distinct from old.requested_clan_id then
    raise exception 'requested_clan_id is set by link_verified_player(), not directly';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Verify:
--
--   select proname, prosecdef from pg_proc where proname = 'link_verified_player';
--     -- expect one row, prosecdef = true
--
--   select has_table_privilege('authenticated', 'players', 'update');
--     -- expect FALSE. If this is ever true, the function above has been made
--     -- redundant by a grant and players is writable from a session.
-- ---------------------------------------------------------------------------

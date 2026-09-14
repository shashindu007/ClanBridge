-- T11.2 — Verifying a second base must not re-route the first one's approval.
--
-- 016 is untouched. A migration that has been applied is never edited (§4), so
-- this replaces the function forward, the way 017 and 018 each replaced
-- approve_account(). Read 016's header first: everything it says about why this
-- is a definer function and why `players` stays select-only for a session is
-- still true, and none of it changes here.
--
--
-- THE BUG
--
-- 016 ends its write path with, unconditionally:
--
--     update public.users
--     set requested_clan_id = v_clan_id
--     where id = auth.uid() and deleted_at is null;
--
-- That was right when an account had one base, because it ran exactly once.
-- Phase 11 makes a second base an ordinary thing to add (Architecture.md §7.1
-- has said since the first draft that a member may own more than one player
-- account and that they may sit in different clans), and then it runs again —
-- overwriting a column whose whole purpose is to name the ONE clan whose leader
-- has been asked to approve this account.
--
-- Two distinct failures fall out of that, and each of the two new conditions
-- below prevents one of them.
--
--   requested_clan_id is null  —  A STILL-PENDING MEMBER IS SILENTLY RE-ROUTED.
--     They verify their main in clan A, and the leader of clan A now sees them
--     in the queue (013's "leaders read pending applicants to their clans"
--     filters on this column). They then verify their alt in clan B. The column
--     moves to clan B, they vanish out of clan A's queue, and the leader who
--     was already looking at them has no idea. Nothing reports it. First tag
--     wins is the only rule here that does not need a person to notice
--     something disappeared.
--
--   status = 'pending'  —  AN APPROVED ACCOUNT IS MADE TO LOOK LIKE AN
--     APPLICANT. For an approved account this column is history: approve_account()
--     requires status = 'pending' (018) and so can never run a second time, and
--     nothing else reads it. Rewriting it puts an already-approved member into
--     the pending queue of a leader of a clan they were never approved into —
--     visible to that leader, actionable by nobody, and impossible to explain
--     from the UI.
--
-- Both are `and` clauses on one statement rather than an `if` around it, so the
-- function's shape, its return contract and its audit row are all unchanged. The
-- audit row is still written on every link, which is what keeps a second base
-- an auditable event even though it moves no column on `users`.
--
--
-- WHAT IS DELIBERATELY NOT FIXED HERE
--
-- A pending member routed to the wrong clan cannot re-route themselves. That is
-- deliberate, not an oversight: self-service re-routing is exactly the
-- escalation 016's guard trigger was added to close, and re-opening it through
-- this function would hand back the same capability by a different door. With
-- one leader across the family the cost today is a message in game.
--
-- There is also NO "primary base" notion, and Phase 11 does not need one. The
-- dashboard lists every base with no privileged first, and "which clan am I
-- approved into" is answered by clan_roles, not by a base. If a default is ever
-- wanted the shape is a users.primary_player_id column — owner-writable for
-- free, like username in 030 — and not a flag on player_nicknames, which would
-- need a per-account partial unique index and a rule for what happens when the
-- primary base leaves the family.


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
  --
  -- Re-verifying a tag the CALLER already owns is not theft and falls through:
  -- the token rotates every time it is viewed in game, so a member re-running
  -- verification on their own base is an ordinary thing to do, and the update
  -- below is idempotent for them.
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
  -- requested_clan_id, and 016's guard trigger refuses a direct write to it — so
  -- this function is still the only way it can ever be set, and a member cannot
  -- nominate themselves into a clan they have no account in.
  --
  -- T11.2 — the two clauses after `deleted_at is null` are the whole of this
  -- migration. See the header: the first keeps a pending applicant in the queue
  -- of the leader already asked, the second stops an approved account being
  -- redressed as an applicant. Everything else in this function is 016's.
  update public.users
  set requested_clan_id = v_clan_id
  where id = auth.uid()
    and deleted_at is null
    and status = 'pending'
    and requested_clan_id is null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), v_clan_id, 'verify', 'players', v_player_id,
          jsonb_build_object('verified', true, 'tag', p_tag));

  return jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'clan_id', v_clan_id);
end;
$$;

-- Re-stated because create or replace does not re-run 016's grants if the
-- signature ever changes, and because a reader of this file should not have to
-- open 016 to learn who may call it.
revoke execute on function link_verified_player(text) from public;
grant execute on function link_verified_player(text) to authenticated;

comment on function link_verified_player(text) is
  'T3.3/T11.2 - links a verified player tag to auth.uid(). Routes the account to '
  'that clan''s leader for approval on the FIRST link only, so adding a second '
  'base neither re-routes a pending applicant nor redresses an approved account '
  'as one. The only write path to players from a session (R11).';

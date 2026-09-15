-- T11.1 — A member can read every base they own.
--
-- READ THE R3 ARGUMENT BELOW BEFORE CHANGING ANYTHING IN THIS FILE. It adds a
-- SELECT policy that is not filtered by clan, which is the exact shape R3 exists
-- to forbid. It is deliberate, and the reasoning is written out here rather than
-- in a commit message so that the next reader — human or assistant — finds it
-- attached to the policy instead of flagging the file and reverting it.
--
--
-- THE BUG THIS CLOSES
--
-- 016's link_verified_player() writes players.user_id for any number of tags,
-- so one account owning several villages has always worked at this level. But
-- `players` has exactly one SELECT policy, 006's
--
--     using (clan_id in (select auth_clan_ids()))
--
-- and auth_clan_ids() reads clan_roles. A member approved into clan A who then
-- verifies a second village sitting in clan B has that row's user_id set to
-- their own id, and is then forbidden to read it. They proved ownership with an
-- in-game token and the result of that write is invisible to them.
--
-- A write whose result cannot be read by the person who caused it is the same
-- defect class as the null-clan_id audit row recorded in IMPLEMENTATION.md's
-- note on definer functions: "writing rows nobody can read is worse than not
-- writing them." This is that, one table over.
--
--
-- WHY THIS IS NOT AN R3 VIOLATION
--
-- R3's substance is that a member must not see ANOTHER CLAN'S DATA. The policy
-- below returns only rows whose user_id is the caller — villages the caller
-- personally proved they own with an in-game API token (R8, T3.3). No row about
-- another person becomes visible to anybody.
--
-- The axis left unfiltered is clan; the filter that replaces it, user_id =
-- auth.uid(), is strictly NARROWER than the clan filter would have been, not
-- wider. A member of a fifty-person clan can read fifty players rows under
-- 006's policy and one or two under this one.
--
-- The codebase already names this exception in the other direction, and says so
-- in those words. repositories/members.ts's clanMovement() is "NOT filtered to
-- one clan — that is the point", and [clanTag]/player/[tag]/page.tsx calls it
-- "the deliberate exception". That read is unfiltered by clan and filtered by
-- player_id. This one is unfiltered by clan and filtered by user_id. Same
-- shape, one layer lower.
--
-- Two more properties keep the blast radius small:
--
--   Permissive SELECT policies are OR-ed by Postgres, so this only ever ADDS
--   rows. 006's "read own clan players" is untouched, and nothing that relied
--   on it changes behaviour.
--
--   It reaches `players` and nothing else. member_snapshots, wars, cwl_*,
--   war_*, base_layouts, clan_roles and clans all keep clan_id in (select
--   auth_clan_ids()). So a village in a clan the member holds no role in is
--   visible as a tag, a name and a town hall level, and nothing more — no
--   donations, no war history, not even the clan's NAME. That is precisely the
--   degraded state /account/bases/[tag] renders (T11.12), and it is why that
--   state is the honest design rather than a user-experience compromise.
--
-- REJECTED ALTERNATIVE: widening 006's policy to a join through clan_roles so
-- that owning a village in a clan implies reading that clan's players. That
-- grows the CLAN set, which is the R3 violation this is not. It would hand a
-- member the full roster of a clan nobody approved them into.
--
-- R3's discipline stays visible in application code regardless: basesForUser()
-- (T11.6) filters .eq("user_id", userId) explicitly. The policy is the net, as
-- 006's header insists — not a substitute for the filter.


-- ---------------------------------------------------------------------------
-- Which players does the current user own?
--
-- The mirror of 006's auth_clan_ids(), and security definer for the same
-- reason: the function reads `players`, and the policy below is itself a policy
-- ON `players`. Running as the definer bypasses RLS inside the body, which is
-- what stops that becoming infinite recursion — and it also means T11.3's
-- player_nicknames policies can call this without depending on which of
-- `players`' two SELECT policies happens to match.
--
-- set search_path = '' with fully qualified names, against a search_path
-- hijack, exactly as every other definer function in this schema does.
--
-- deleted_at is null, and NOT left_at is null. A member who left a clan still
-- owns the village — that is what T3.9 added left_at to record — and their own
-- history is the thing they are most likely to come here to read.
-- ---------------------------------------------------------------------------
create or replace function auth_owned_player_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.players
  where user_id = auth.uid()
    and deleted_at is null
$$;

revoke execute on function auth_owned_player_ids() from public;
grant execute on function auth_owned_player_ids() to authenticated;


-- ---------------------------------------------------------------------------
-- The policy itself.
--
-- `to authenticated` so the anon role matches nothing, as every policy in 006
-- is. auth.uid() is null without a session, and `user_id = null` is never true,
-- so an anonymous request would read zero rows even without that clause — but
-- stating the role is the convention here and it makes the intent legible.
--
-- No new grant is needed: 006 already issued `grant select on all tables in
-- schema public to anon, authenticated`, and 014 set the default privilege for
-- tables added later. A grant is not access; RLS still decides which rows come
-- back.
-- ---------------------------------------------------------------------------
create policy "read own players" on players
  for select to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- No insert, update or delete policy on `players`, and there must never be one.
--
-- 016's header explains it at length: `players` holds GAME FACTS (R11), written
-- only by scripts/sync/ under the service role. The only member-initiated write
-- is link_verified_player(), a security definer function, precisely so that the
-- session itself keeps no write privilege. 016 documents a verification query
-- asserting has_table_privilege('authenticated', 'players', 'update') is FALSE.
-- That stays true after this file: a SELECT policy grants no writes.
--
-- The per-base nickname a member sets is a HUMAN DECISION and therefore lives
-- in its own table — see 033_player_nicknames.sql.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Sanity check after applying. As a member of clan A who owns a village in
-- clan B, with a session:
--
--   select count(*) from players;                 -- their own villages + clan A's roster
--   select count(*) from clans;                   -- clan A only, NOT clan B
--   select count(*) from clan_roles;              -- clan A only
--   select count(*) from member_snapshots;        -- clan A only
--
-- If the second query returns clan B, something else has been widened and this
-- file is not the cause. test/account-bases.test.ts asserts all four.
-- ---------------------------------------------------------------------------

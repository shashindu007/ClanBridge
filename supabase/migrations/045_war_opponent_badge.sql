-- The opponent's badge, on every war and CWL war synced from now on.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- The war board, the clan page and Home draw a war the way the game does: two
-- clans facing each other, each under its badge. Our own badge has been stored
-- since 001 (clans.badge_url). The opponent's never was. The API sends it on
-- every war response (clan.badgeUrls / opponent.badgeUrls), and mapWarSide()
-- dropped it, so the other side of every war was a name in a cell, the one
-- thing on the board a member could not recognise at a glance.
--
-- A URL on api-assets.clashofclans.com, exactly as the API returns it. It is the
-- second of the two sources globals.css allows art from. Nothing is copied or
-- stored beyond the address.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ONLY GOING FORWARD, AND THAT IS CORRECT
--
-- Both sync jobs refuse to touch a war once it has ended. For wars that is the
-- `settled.state === 'warEnded'` return in scripts/sync/war.ts; for CWL it is
-- settledWarTags(). That is R5, and a new column is no reason to reopen
-- history. So a war that ended before this migration keeps NULL here forever,
-- and the page draws the product's own shield in the opponent's colour
-- (components/game/clan-badge.tsx). A war that is still running when this lands
-- gets its badge on the next sync.
--
-- No backfill, no RLS change. Both tables' row policies cover every column, and
-- the sync role's table-level grants (014) include a column added later.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.wars add column if not exists opponent_badge_url text;
alter table public.cwl_wars add column if not exists opponent_badge_url text;

comment on column public.wars.opponent_badge_url is
  'The opponent clan''s badge (API badgeUrls.medium, else small). NULL for wars that ended before 045.';
comment on column public.cwl_wars.opponent_badge_url is
  'The opponent clan''s badge (API badgeUrls.medium, else small). NULL for wars that ended before 045.';

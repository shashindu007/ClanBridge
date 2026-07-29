-- T3.9 — players.left_at.
--
-- Players move between the three clans, and some leave entirely. Neither event
-- may lose history: a member's CWL record belongs to the clan family regardless
-- of where they are now, and R4 means the row is never deleted.
--
-- Two distinct states, and conflating them is the bug to avoid:
--
--   moved between our clans  -> players.clan_id changes, left_at stays null.
--                               All history stays attached to the PLAYER, not
--                               the clan, so nothing needs rewriting.
--
--   left all three clans     -> left_at is set, clan_id is left as it was.
--                               The row and every attack, snapshot and bonus
--                               survive. Access is revoked by left_at, not by
--                               removing anything.
--
-- A returning member is simply left_at = null again, with their whole history
-- intact and their original row reused — which is why players.tag is unique.

alter table players
  add column left_at timestamptz;

comment on column players.left_at is
  'Set when the player is in none of the three clans. Never delete the row (R4) '
  '- their history is part of the clan family record. Null again if they return.';

-- The member directory and every sync read filters on "still here", so index for
-- that shape rather than the whole table.
create index players_active_idx
  on players (clan_id)
  where deleted_at is null and left_at is null;

-- T3B.5 needs the opposite view: who has gone, and when.
create index players_left_idx
  on players (left_at desc)
  where left_at is not null;

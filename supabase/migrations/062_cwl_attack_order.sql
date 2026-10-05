-- 062 — The order of attacks within a CWL war.
--
-- 057 keeps each lineup member's one attack inline: stars, destruction, and
-- the base it hit. It did not keep WHEN in the war the attack came, and the API
-- says so on every attack (`order`, 1 for the first attack of the war).
--
-- The CWL player rating needs it. A base two clanmates attacked gave the clan
-- its best result once, not twice: three stars on a base already at two added
-- ONE star. Without the order there is no telling which attack came first, so
-- both were rated as if they had opened the base.
--
-- One nullable column, on the table that already holds both sides of every
-- group war. Null means "did not attack", or "recorded before 062" — the sync
-- fills a missing order in for this season's own wars while the API still has
-- them, and never touches the stars beside it. A row left without one is rated
-- as a first hit, exactly as it was before.
--
-- No backfill here: the value exists only in the API, not in this database.

alter table cwl_group_war_members add column attack_order smallint;

comment on column cwl_group_war_members.attack_order is
  'The API''s order of this attack within the war (1 = first). Null without an attack, or before 062.';

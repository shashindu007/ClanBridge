-- 060 — the Town Hall weapon level of each scouted village.
--
-- The API reports no building of a village but one: the Town Hall's weapon
-- (townHallWeaponLevel). Only some halls have one — src/data/game knows which
-- and its cap — so a null here means "this hall has no weapon" as often as
-- "not read yet". Read on the same /players call the scout already makes.

alter table cwl_scout_players add column th_weapon_level smallint;

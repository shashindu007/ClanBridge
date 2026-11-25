// Which Fan Kit file becomes which key. Pinned with the shapes of name a kit
// actually uses, because a wrong match is a Hog Rider standing where a
// Valkyrie should be and nothing else would ever notice.

import { describe, expect, it } from "vitest";
import buildingsFile from "../src/data/game/buildings.json";
import unitsFile from "../src/data/game/units.json";
import {
  comparePreference,
  folderFor,
  isIconFile,
  matchArtKey,
  preference,
  words,
  type KnownBuilding,
  type KnownUnit,
} from "./game-art.map";

const units = unitsFile.units as KnownUnit[];
const buildings = buildingsFile.buildings as KnownBuilding[];
const key = (path: string) => matchArtKey(path, units, buildings);

describe("words", () => {
  it("splits folders, underscores and camel case, and drops decoration", () => {
    expect(words("Heroes/Barbarian_King_render_HD.png")).toEqual(["heroes", "barbarian", "king"]);
    expect(words("Troops\HogRider-icon.webp")).toEqual(["troops", "hog", "rider"]);
  });
});

describe("matchArtKey", () => {
  it("reads a Town Hall's number from the file name", () => {
    expect(key("Buildings/Town Hall/Town_Hall_17.png")).toBe("th-17");
    expect(key("Buildings/TH18.png")).toBe("th-18");
    expect(key("th 9.png")).toBe("th-9");
  });

  it("does not take a Town Hall number from a folder alone", () => {
    // A "Town Hall 17" folder holds the hall's weapon art as well.
    expect(key("Town Hall 17/Giga Inferno.png")).toBeNull();
  });

  it("prefers the longest name, so a hero is not its troop", () => {
    expect(key("Heroes/Barbarian King.png")).toBe("hero-barbarian-king");
    expect(key("Troops/Barbarian.png")).toBe("troop-barbarian");
    expect(key("Super Troops/Super Barbarian.png")).toBe("troop-super-barbarian");
    expect(key("Heroes/Minion Prince.png")).toBe("hero-minion-prince");
  });

  it("keeps the two villages apart by folder", () => {
    expect(key("Home Village/Troops/Baby Dragon.png")).toBe("troop-baby-dragon");
    expect(key("Builder Base/Troops/Baby Dragon.png")).toBe("builder-troop-baby-dragon");
    expect(key("Builder Base/Battle Machine.png")).toBe("hero-battle-machine");
  });

  it("finds a spell filed without the word spell", () => {
    expect(key("Spells/Lightning.png")).toBe("spell-lightning-spell");
    expect(key("Spells/Rage_Spell.png")).toBe("spell-rage-spell");
  });

  it("reads a league and its division", () => {
    expect(key("Leagues/Crystal League I.png")).toBe("league-crystal-1");
    expect(key("Leagues/master_league_3.png")).toBe("league-master-3");
    expect(key("Leagues/Legend League.png")).toBe("league-legend");
  });

  it("reads the kit's own Town Hall and league spellings", () => {
    expect(key("Building_HV_Town_Hall_level_16_1.png")).toBe("th-16");
    expect(key("Building_HV_Town_Hall_level_11.png")).toBe("th-11");
    expect(key("league-legend.png")).toBe("league-legend");
    expect(key("League_Crystal_2.png")).toBe("league-crystal-2");
    // A league BADGE with a troop on it is still a badge, not a league icon.
    expect(key("League_Badge_Titan.png")).toBeNull();
  });

  it("reads the kit's BB and HV prefixes as the village", () => {
    expect(key("Icon_BB_Boxer_Giant.png")).toBe("builder-troop-boxer-giant");
    expect(key("Icon_BB_Raged_Barbarian.png")).toBe("builder-troop-raged-barbarian");
    expect(key("Icon_HV_Hog_Rider.png")).toBe("troop-hog-rider");
    expect(key("Icon_HV_Hero_Archer_Queen.png")).toBe("hero-archer-queen");
  });

  it("never files a badge or a scene under a unit", () => {
    expect(key("League_Badge_Archer.png")).toBeNull();
    expect(key("League_Badge_PEKKA.png")).toBeNull();
    expect(key("SkeletonKingdom_withCharacters.jpg")).toBeNull();
    expect(key("Villager_HV_Villager_11.png")).toBeNull();
    expect(key("Loading_Screen_2023_Builder_Base_2.png")).toBeNull();
  });

  it("takes a spell's short name only inside a Spells folder", () => {
    expect(key("Skeleton.png")).toBeNull();
    expect(key("Spells/Skeleton.png")).toBe("spell-skeleton-spell");
  });

  it("reads the kit's CWL badges as the war league, typos and all", () => {
    expect(key("Icon_HV_CWL_Master_1.png")).toBe("league-master-1");
    expect(key("Icon_HV_CWL_Champion_3.png")).toBe("league-champion-3");
    // Named "Silver_12" and "Silver_13" in the kit; the badges read II and III.
    expect(key("Icon_HV_CWL_Silver_12.png")).toBe("league-silver-2");
    expect(key("Icon_HV_CWL_Silver_13.png")).toBe("league-silver-3");
  });

  it("files a file that says Super only under a super troop", () => {
    // The product has no Super P.E.K.K.A; this is not the P.E.K.K.A.
    expect(key("Icon_CC_Troop_Super_P.E.K.K.A.png")).toBeNull();
    expect(key("Icon_HV_P.E.K.K.A.png")).toBe("troop-pekka");
    // Super troops whose own names lack the word.
    expect(key("Icon_HV_Super_Ice_Hound.png")).toBe("troop-ice-hound");
    expect(key("Icon_HV_Super_Inferno_Dragon.png")).toBe("troop-inferno-dragon");
  });

  it("files hero gear only as equipment, even when it names a hero or a troop", () => {
    expect(key("HeroGear_RoyalChampion_RocketSpear_Equipment_02.png")).toBe("equipment-rocket-spear");
    expect(key("Hero_Equipment_RC_Hog_Rider_Doll.png")).toBe("equipment-hog-rider-puppet");
    expect(key("HG_DD_Fire Heart.png")).toBe("equipment-fire-heart");
  });

  it("knows the kit's own names for renamed items", () => {
    expect(key("HeroGear_BK_StickFireHorse.png")).toBe("equipment-stick-horse");
    expect(key("HG_DD_StunBlast.png")).toBe("equipment-stun-blaster");
    expect(key("HG_DD_Rocket_BackPack.png")).toBe("equipment-rocket-backpack");
    expect(key("Hero_Equipment_MP_Henchman.png")).toBe("equipment-henchmen-puppet");
    expect(key("HeroEquipment_MP_IronPants.png")).toBe("equipment-metal-pants");
    expect(key("Hero_Equipment_AQ_WWEActionFigure.png")).toBe("equipment-action-figure");
    expect(key("Icon_HV_Spell_Heal.png")).toBe("spell-healing-spell");
    // Unconfirmed which item it is, so it stays unused rather than guessed.
    expect(key("Hero_Equipment_MP_PowerPump.png")).toBeNull();
  });

  it("leaves anything it cannot name unused", () => {
    expect(key("Backgrounds/Loading Screen.jpg")).toBeNull();
    expect(key("Misc/Gems.png")).toBeNull();
  });
});

describe("matchArtKey — buildings and traps", () => {
  it("files a building render under its village", () => {
    expect(key("Buildings/Building_HV_Cannon_level_21.png")).toBe("building-cannon");
    expect(key("Builder Base/Building_BB_Cannon_level_10.png")).toBe("builder-building-cannon");
    expect(key("Building_BB_Roaster.png")).toBe("builder-building-roaster");
  });

  it("never files a building as the troop it is named after", () => {
    expect(key("Building_HV_Archer_Tower_level_21.png")).toBe("building-archer-tower");
    expect(key("Building_HV_Wizard_Tower.png")).toBe("building-wizard-tower");
    expect(key("Building_HV_Unknown_Thing.png")).toBeNull();
  });

  it("takes the longest trap name, so a Giant Bomb is not a Bomb", () => {
    expect(key("Traps/Trap_HV_Giant_Bomb.png")).toBe("trap-giant-bomb");
    expect(key("Traps/Trap_HV_Bomb.png")).toBe("trap-bomb");
  });

  it("still files a unit kept in a Defenses folder as the unit", () => {
    expect(key("Defenses/Icon_HV_Hog_Rider.png")).toBe("troop-hog-rider");
  });

  it("leaves the halls to Town Hall art", () => {
    expect(key("Buildings/Building_HV_Town_Hall_level_16.png")).toBe("th-16");
  });
});

// The 2026-11 asset zips (TH19): renders named by hand, with no "Building" and
// with words run together. Each was checked against its picture.
describe("matchArtKey — the 2026-11 asset zips", () => {
  it("files a building whose name has no 'Building' in it", () => {
    expect(key("X-Bow_lvl14.png")).toBe("building-x-bow");
    expect(key("Hidden_Tesla_lvl18.png")).toBe("building-hidden-tesla");
    expect(key("pet_house_level_12.png")).toBe("building-pet-house");
    expect(key("hero_hall_lvl_11.png")).toBe("building-hero-hall");
    expect(key("squad_barracks_lvl12.png")).toBe("building-squad-barracks");
    expect(key("Giga_Bomb_HV_02_nograss.png")).toBe("trap-giga-bomb");
    expect(key("firespitter_lvl2.png")).toBe("building-firespitter");
  });

  it("splits a level word glued to the name", () => {
    expect(words("Building_HV_elixir_Collectorlevel_18.png")).toEqual(["building", "hv", "elixir", "collector", "level", "18"]);
    expect(key("Building_HV_elixir_Collectorlevel_18.png")).toBe("building-elixir-collector");
  });

  it("reads the kit's own names for buildings", () => {
    expect(key("BuilderHut_lvl9.png")).toBe("building-builders-hut");
    expect(key("Building_HV_Builder_Hut_Level_7.png")).toBe("building-builders-hut");
    expect(key("CAT_cannon_multi_gear_lvl4.png")).toBe("building-multi-gear-tower");
    expect(key("CAT_archer_lvl2_2k.png")).toBe("building-multi-gear-tower");
    expect(key("Building_HV_Merged_Wizard_Tower_lvl2.png")).toBe("building-super-wizard-tower");
  });

  it("reads run-together unit names, squads and the kit's 'Equipement'", () => {
    expect(key("hogrider_lvl_16.png")).toBe("troop-hog-rider");
    expect(key("meteorgolem_lvl04.png")).toBe("troop-meteor-golem");
    expect(key("icon_barcher_squad.png")).toBe("troop-barch-squad");
    expect(key("info_squad_giant_wizard.png")).toBe("troop-giant-wizard-squad");
    expect(key("Hero_Equipement_portal_pendant.png")).toBe("equipment-portal-pendant");
  });

  it("leaves a plain troop file to the troop, and an unknown building unused", () => {
    expect(key("witch_lvl_9.png")).toBe("troop-witch");
    // Not in the game data yet: no id, so no key — never a near miss.
    expect(key("Spiky_Tower_lvl2.png")).toBeNull();
    expect(key("guardian_shrine_lvl1_4k.png")).toBeNull();
    expect(key("B.O.T.O_hut.png")).toBeNull();
    expect(key("Building_HV_Altar_Barbarian_King_sleeping.png")).toBeNull();
  });

  it("takes the plain TH19 render over the one with a wizard posed on it", () => {
    expect(key("TH19_Wizard_Render_Ingame.png")).toBe("th-19");
    expect(key("TH19_building_base_003.png")).toBe("th-19");
    expect(
      comparePreference(preference("TH19_building_base_003.png"), preference("TH19_Wizard_Render_Ingame.png")),
    ).toBeGreaterThan(0);
  });
});

// The 2026-11-24 asset zips: two-level trap renders, an Air Sweeper, and the
// kit's run-together "spelltower". Each was checked against its picture.
describe("matchArtKey — the 2026-11-24 asset zips", () => {
  it("reads two-level trap renders", () => {
    expect(key("Building_HV_Bomb_level_9&10.png")).toBe("trap-bomb");
    expect(key("Building_HV_Giant_Bomb_level_11&12.png")).toBe("trap-giant-bomb");
    expect(key("Building_HV_Skeleton_Trap_level_3&4.png")).toBe("trap-skeleton-trap");
    expect(key("Giga_Bomb_HV_01.png")).toBe("trap-giga-bomb");
  });

  it("files buildings by village", () => {
    expect(key("Building_HV_Air_Sweeper_level_7.png")).toBe("building-air-sweeper");
    expect(key("Building_HV_Blacksmith_level_1&2.png")).toBe("building-blacksmith");
    expect(key("Building_BB_Air_Bombs_level_3.png")).toBe("builder-building-air-bombs");
    expect(key("Scattershot_lvl7.png")).toBe("building-scattershot");
    expect(key("Icon_BB_Bomber.png")).toBe("builder-troop-bomber");
    expect(key("Building_CC_Bomb_Tower_level_5.png")).toBe("building-bomb-tower");
  });

  it("reads the kit's run-together Spell Tower", () => {
    expect(key("spelltower_lvl4_marketing.png")).toBe("building-spell-tower");
  });

  it("leaves a file it cannot tie to one item unused", () => {
    expect(key("crafted defence  (1).png")).toBeNull();
  });
});

describe("folderFor", () => {
  it("files every family under its own folder", () => {
    expect(folderFor("th-17")).toBe("townhall");
    expect(folderFor("hero-archer-queen")).toBe("heroes");
    expect(folderFor("builder-troop-baby-dragon")).toBe("builder-troops");
    expect(folderFor("league-crystal-1")).toBe("leagues");
    expect(folderFor("building-cannon")).toBe("buildings");
    expect(folderFor("builder-building-cannon")).toBe("builder-buildings");
    expect(folderFor("trap-bomb")).toBe("traps");
    expect(folderFor("builder-trap-mine")).toBe("traps");
  });
});

describe("isIconFile", () => {
  it("tells the kit's square icons from its renders", () => {
    expect(isIconFile("Icon_HV_Hero_Archer_Queen.png")).toBe(true);
    expect(isIconFile("Troops/hog_rider_icon.webp")).toBe(true);
    expect(isIconFile("Archer_Queen_1.png")).toBe(false);
    expect(isIconFile("Icons/Lexicon_Poster.png")).toBe(false);
  });
});

describe("preference", () => {
  const better = (a: string, b: string) => comparePreference(preference(a), preference(b)) > 0;

  it("takes a CWL badge over a trophy-league icon of the same name", () => {
    expect(better("Icon_HV_CWL_Master_2.png", "Icon_HV_League_Master_2.png")).toBe(true);
  });

  it("takes the home village's file over Clan Capital's, icon or not", () => {
    expect(better("Icon_HV_Spell_Rage.png", "Icon_CC_Spell_Rage.png")).toBe(true);
    expect(better("Icon_HV_Dark_Spell_Haste.png", "Icon_CC_Spell_Endless_Haste.png")).toBe(true);
    expect(better("Archer_Queen_1.png", "Clan Capital/Icon_Archer_Queen.png")).toBe(true);
  });

  it("takes an icon over a render, and a new file over an old one", () => {
    expect(better("Icon_HV_Hero_Archer_Queen.png", "Archer_Queen_1.png")).toBe(true);
    expect(better("Icon_HV_Spell_Freeze_new.png", "Icon_HV_Spell_Freeze_old.png")).toBe(true);
  });

  it("takes a building's highest level render", () => {
    expect(better("Building_HV_Cannon_level_21.png", "Building_HV_Cannon_level_9.png")).toBe(true);
    expect(better("Building_HV_Air_Sweeper_level_7.png", "Building_HV_Air_Sweeper_level_6.png")).toBe(true);
    expect(better("Building_HV_Giant_Bomb_level_11&12.png", "Building_HV_Giant_Bomb_level_5&6.png")).toBe(true);
  });

  it("takes the home village's building over Clan Capital's", () => {
    expect(better("Building_HV_Bomb_Tower_level_5.png", "Building_CC_Bomb_Tower_level_5.png")).toBe(true);
  });

  it("calls two files of the same kind even, for the file size to decide", () => {
    expect(comparePreference(preference("Icon_HV_Golem.png"), preference("Icon_HV_Witch.png"))).toBe(0);
  });
});

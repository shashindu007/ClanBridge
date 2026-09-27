// Which Fan Kit file becomes which key. Pinned with the shapes of name a kit
// actually uses, because a wrong match is a Hog Rider standing where a
// Valkyrie should be and nothing else would ever notice.

import { describe, expect, it } from "vitest";
import unitsFile from "../src/data/game/units.json";
import { folderFor, isIconFile, matchArtKey, words, type KnownUnit } from "./game-art.map";

const units = unitsFile.units as KnownUnit[];
const key = (path: string) => matchArtKey(path, units);

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

  it("leaves anything it cannot name unused", () => {
    expect(key("Backgrounds/Loading Screen.jpg")).toBeNull();
    expect(key("Misc/Gems.png")).toBeNull();
  });
});

describe("folderFor", () => {
  it("files every family under its own folder", () => {
    expect(folderFor("th-17")).toBe("townhall");
    expect(folderFor("hero-archer-queen")).toBe("heroes");
    expect(folderFor("builder-troop-baby-dragon")).toBe("builder-troops");
    expect(folderFor("league-crystal-1")).toBe("leagues");
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

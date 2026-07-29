// PII scrubbing for captured fixtures.
//
// fixtures/*.json are COMMITTED, because CI runs the offline suite from them.
// Without this, every clan-mate's real name and player tag would sit in git
// history permanently.
//
// Only identity is replaced. Shapes, field names, types, array lengths and every
// numeric value stay exactly as the API returned them — that is the entire point
// of capturing real responses rather than writing them by hand.

/** Supercell's tag alphabet. Replacements must satisfy lib/tags.ts and the database check constraints. */
const TAG_ALPHABET = "0289PYLQGRJCUV";

/** Keys that hold a person's identity. */
const TAG_KEYS = new Set(["tag", "attackerTag", "defenderTag"]);
const NAME_KEYS = new Set(["name"]);

/** Fields that only ever appear on a player object, never on a clan. */
const PLAYER_MARKERS = ["townHallLevel", "expLevel", "donations", "trophies"];

export interface Scrubber {
  scrub(value: unknown): unknown;
  readonly names: number;
  readonly tags: number;
}

/**
 * A scrubber with its own alias tables.
 *
 * Aliases are shared across every file in one run, so a member appearing in both
 * `clan.json` and `player.json` gets the same replacement tag in each and the
 * cross-references still line up.
 */
export function createScrubber(): Scrubber {
  const tagAliases = new Map<string, string>();
  const nameAliases = new Map<string, string>();

  // Deterministic from the real value, so re-capturing produces a stable diff
  // rather than churning every line of every fixture.
  function fakeTag(real: string): string {
    const existing = tagAliases.get(real);
    if (existing) return existing;

    let hash = 0;
    for (const ch of real) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

    let out = "#";
    for (let i = 0; i < 8; i++) {
      out += TAG_ALPHABET[hash % TAG_ALPHABET.length];
      hash = Math.floor(hash / TAG_ALPHABET.length) + (i + 1) * 7919;
    }

    tagAliases.set(real, out);
    return out;
  }

  function fakeName(real: string): string {
    const existing = nameAliases.get(real);
    if (existing) return existing;
    const alias = `Player ${String(nameAliases.size + 1).padStart(2, "0")}`;
    nameAliases.set(real, alias);
    return alias;
  }

  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;

    const source = value as Record<string, unknown>;

    // A `name` beside townHallLevel or donations belongs to a player. A `name`
    // beside clanLevel or badgeUrls belongs to a clan, which is not personal
    // data and stays readable — fixtures are far easier to reason about when
    // the clan is still called by its name.
    const isPlayer = PLAYER_MARKERS.some((marker) => marker in source);

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(source)) {
      if (TAG_KEYS.has(key) && typeof v === "string" && v.startsWith("#")) {
        out[key] = fakeTag(v);
      } else if (NAME_KEYS.has(key) && typeof v === "string" && isPlayer) {
        out[key] = fakeName(v);
      } else {
        out[key] = walk(v);
      }
    }
    return out;
  }

  return {
    scrub: walk,
    get names() {
      return nameAliases.size;
    },
    get tags() {
      return tagAliases.size;
    },
  };
}

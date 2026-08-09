// A colour per clan, derived — never looked up.
//
// R3, and the same argument lib/clans.ts:1-9 makes: there is no hardcoded list
// of the three clans anywhere in this codebase, and a `Record<clanTag, colour>`
// would be one. It would also be the worst kind, because nothing breaks when it
// falls out of date — a fourth clan just renders with no colour, or worse,
// silently shares clan two's, and the switcher quietly stops distinguishing
// them. Deriving from the id means a clan added at /admin has a colour before
// anyone has typed its name anywhere.
//
// Three slots because the platform runs three clans, and because three is what
// the palette can guarantee. The hues are slots 1-3 of the reference categorical
// palette, validated as a set across ALL pairs in both light and dark: worst
// colour-blind separation ΔE 9.2 / 9.4 against a target of 8, worst
// normal-vision ΔE 24.0 / 20.9 against a floor of 15. A fourth slot would put
// yellow beside orange and fail both. So a fourth clan wraps and shares a hue
// with the first — which is honest degradation: two clans looking alike is
// recoverable, two clans looking DIFFERENT but indistinguishable to a
// colour-blind reader is not.
//
// The colour is never the only signal. Every place it renders, the clan's name
// is already there — see globals.css on why aqua in particular may not stand
// alone (2.82:1 on white).

/** How many `--clan-N` tokens globals.css defines. Keep the two in step. */
export const CLAN_ACCENT_COUNT = 3;

export interface ClanAccent {
  /** 1-based, matching the `--clan-N` custom properties. */
  slot: number;
  /** The hue itself — the switcher dot, the dashboard's header stripe. */
  color: string;
}

/**
 * FNV-1a, 32-bit.
 *
 * Any stable hash would do; this one is four lines and has no dependencies.
 * What matters is only that it is *deterministic* — the same clan must get the
 * same colour on every render, on every machine, forever. Something seeded by
 * insertion order or by `Math.random` would give a leader a clan that changes
 * colour between page loads, which is worse than no colour at all.
 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Multiply by the FNV prime (16777619) in 32-bit space. Math.imul rather
    // than `*` because the product overflows a double's integer range.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The accent for a clan, from its id.
 *
 * The id and not the tag: a tag is game-side and a clan can be renamed or
 * re-tagged, and a colour that changes when a leader edits the clan name is a
 * colour nobody learns to trust. The id is ours and never changes.
 */
export function clanAccent(clanId: string): ClanAccent {
  const slot = (hash(clanId) % CLAN_ACCENT_COUNT) + 1;
  return { slot, color: `var(--clan-${slot})` };
}

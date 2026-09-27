// One vocabulary for "how did this war day go", shared by every page that draws
// one: the CWL day tabs, the season strip, the war board and both print views.
//
// Before this each page carried its own copy of the same five-way switch —
// result first, then state — and they had already drifted: one said "Draw", the
// other "Tie". A tone decided in one place is a colour that means the same thing
// everywhere, which is the whole point of colouring the tabs.
//
//   win      green     the day is over and we won it
//   loss     red       the day is over and we lost it
//   tie      neutral   over, level on stars and destruction
//   live     yellow    battle day is running now
//   prep     blue      preparation — the lineup is set, nobody can attack
//   pending  grey      scheduled, not started, or no data

export type DayTone = "win" | "loss" | "tie" | "live" | "prep" | "pending";

export function dayTone(result: string | null | undefined, state: string | null | undefined): DayTone {
  // State first. The CWL sync computes `result` from the stars as they stand,
  // so a day still being fought already carries "win" or "lose" — and a live
  // day painted green because we are ahead at lunchtime is the wrong message.
  if (state === "inWar") return "live";
  if (state === "preparation") return "prep";
  if (result === "win") return "win";
  if (result === "lose" || result === "loss") return "loss";
  if (result === "tie") return "tie";
  return "pending";
}

export const DAY_TONE_LABEL: Record<DayTone, string> = {
  win: "Won",
  loss: "Lost",
  tie: "Draw",
  live: "Ongoing",
  prep: "Preparation",
  pending: "Not started",
};

/**
 * Classes for a tile or pill in a tone. Built from the status tokens in
 * globals.css, so both themes and the print sheet get measured colours.
 *
 * `solid` is a filled chip (the season strip); `soft` is a tinted surface with
 * a coloured edge (the day tabs), where text has to stay readable on it.
 */
export const DAY_TONE_CLASS: Record<DayTone, { solid: string; soft: string; dot: string; text: string }> = {
  win: {
    solid: "bg-success text-white",
    soft: "border-success/60 bg-success-tint text-success-ink",
    dot: "bg-success",
    text: "text-success-ink",
  },
  loss: {
    solid: "bg-destructive text-white",
    soft: "border-destructive/60 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
    text: "text-destructive",
  },
  tie: {
    solid: "bg-muted-foreground text-background",
    soft: "border-border bg-muted text-foreground",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  },
  live: {
    solid: "bg-warning text-gold-ink",
    soft: "border-warning/70 bg-warning-tint text-warning-ink",
    dot: "bg-warning",
    text: "text-warning-ink",
  },
  prep: {
    solid: "bg-info text-white",
    soft: "border-info/60 bg-info-tint text-info-ink",
    dot: "bg-info",
    text: "text-info-ink",
  },
  pending: {
    solid: "bg-muted text-muted-foreground",
    soft: "border-dashed border-border bg-tile text-muted-foreground",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
};

/**
 * "2d 4h", "5h 12m 08s", "12m 08s", "45s". Seconds appear only inside the last
 * day, where they are what a member watching the clock actually looks at.
 */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

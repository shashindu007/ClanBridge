// The building blocks of every lineup page — the CWL roster hub and builder, and
// the war lineup — shared so they all say "draft", "published" and "15 slots" the
// same way, and a leader who has learned one page has learned all of them.
//
// Server components with no state. Where a part submits, the page passes its
// server action in as `action` — a server action is a valid prop between server
// components, and it keeps every write in the page file that authorises it.
//
// Three rules the redesign follows, each because a new leader got it wrong:
//   - STATUS IS WORDS FIRST, COLOUR SECOND. "Draft" / "Published" always carry a
//     line saying who can see the lineup; a colour alone meant nothing.
//   - NUMBERS ARE LABELLED. A bare "18" beside a name was a Town Hall level to
//     the person who built it and a mystery to everyone else.
//   - A DISABLED BUTTON SAYS WHY, beside it, rather than looking broken.

import Link from "next/link";
import { CheckCircle2, CircleDashed, CircleHelp, Eye, EyeOff, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SubmitButton } from "@/components/submit-button";
import {
  AVAILABILITY_FILTERS,
  AVAILABILITY_LABELS,
  availabilityOf,
  type AvailabilityFilter,
} from "@/lib/roster-view";

export type LineupStatusValue = "draft" | "published";

// One Town Hall shape for the whole product; it lives with the other game art.
import { TownHall } from "@/components/game/town-hall";
export { TownHall };

/** A poll answer, with an icon so it never depends on colour alone. */
export function AvailabilityBadge({ answer }: { answer: string | null }) {
  const kind = availabilityOf(answer);
  if (kind === "in") {
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden />
        In
      </Badge>
    );
  }
  if (kind === "maybe") {
    return (
      <Badge variant="warning">
        <CircleHelp aria-hidden />
        Maybe
      </Badge>
    );
  }
  if (kind === "out") {
    return (
      <Badge variant="outline" className="text-destructive">
        <XCircle aria-hidden />
        Out
      </Badge>
    );
  }
  if (kind === "none") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <CircleDashed aria-hidden className="size-3" />
        No answer
      </span>
    );
  }
  return <Badge variant="secondary">{answer}</Badge>;
}

/** Draft or published, and — the half that matters — who can see it. */
export function LineupStatus({
  status,
  withHint = false,
}: {
  status: LineupStatusValue;
  withHint?: boolean;
}) {
  const published = status === "published";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant={published ? "success" : "outline"}>
        {published ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
        {published ? "Published" : "Draft"}
      </Badge>
      {withHint && (
        <span className="text-muted-foreground text-xs">
          {published ? "Members can see this lineup" : "Only leaders can see this"}
        </span>
      )}
    </span>
  );
}

/** "11 of 15 players", a bar, and what is left or over. */
export function SlotMeter({ filled, slots }: { filled: number; slots: number }) {
  const left = slots - filled;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="tabular-nums">
          <span className="font-medium">{filled}</span> of {slots} players
        </span>
        <span
          className={`text-xs tabular-nums ${left < 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}
        >
          {left > 0 ? `${left} spot${left === 1 ? "" : "s"} left` : left === 0 ? "Full" : `${-left} too many`}
        </span>
      </div>
      <Progress value={slots > 0 ? (filled / slots) * 100 : 0} label={`${filled} of ${slots} players picked`} />
    </div>
  );
}

/** Last season's CWL, as "6 of 7 attacks" with the season and, if elsewhere, the clan. */
export function LastCwl({
  attacks,
  wars,
  season,
  clanName,
  ownClanName,
}: {
  attacks: number | null;
  wars: number | null;
  season: string | null;
  clanName: string | null;
  ownClanName: string;
}) {
  if (attacks === null || wars === null) {
    return <span className="text-muted-foreground text-xs">No CWL yet</span>;
  }
  const missed = wars - attacks;
  return (
    <span className="block text-sm leading-tight">
      <span className="tabular-nums">
        {attacks} of {wars} attacks
      </span>
      {missed > 0 && (
        <span className="text-destructive block text-xs tabular-nums">{missed} missed</span>
      )}
      <span className="text-muted-foreground block text-xs">
        {season}
        {clanName && clanName !== ownClanName ? ` · in ${clanName}` : ""}
      </span>
    </span>
  );
}

type Action = (formData: FormData) => Promise<void>;

function Hidden({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

/** The minimum a lineup row needs, shared by CWL rosters and war lineups. */
export interface LineupEntry {
  playerId: string;
  name: string;
  thLevel: number | null;
}

/**
 * One lineup: who is in it, how full it is, and publishing. Used for a clan's CWL
 * roster and for a war lineup, so the two builders read the same way.
 *
 * `action` absent means read-only — a member looking at a published lineup.
 * `hidden` carries what every form needs: the lineup's id under whatever name
 * the page's action reads (`rosterId`, `lineupId`), and whatever puts the leader
 * back where they were. `children` renders under the publish button, for extras
 * like linking a war lineup to the war it was for.
 */
export function LineupPanel({
  title,
  status,
  slots,
  members,
  action,
  hidden = {},
  audience = "members of this clan",
  emptyHint = "No players yet. Press Add beside a player in the list to put them in this lineup.",
  children,
}: {
  title: string;
  status: LineupStatusValue;
  slots: number;
  members: LineupEntry[];
  action?: Action;
  hidden?: Record<string, string>;
  /** Who can see it once published, e.g. "members of this clan". */
  audience?: string;
  emptyHint?: string;
  children?: React.ReactNode;
}) {
  const published = status === "published";
  const empty = members.length === 0;

  return (
    <section aria-label={`${title} lineup`} className="cb-panel space-y-4 rounded-lg border p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="cb-title text-xl">{title}</h2>
          <LineupStatus status={status} />
        </div>
        <p className="text-muted-foreground text-xs">
          {published
            ? `Published — ${audience} can see this lineup.`
            : "Draft — only leaders and co-leaders can see it until you publish."}
        </p>
        <SlotMeter filled={members.length} slots={slots} />
      </div>

      {empty ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          {action ? emptyHint : "Nobody has been picked for this lineup yet."}
        </p>
      ) : (
        <ol className="divide-y">
          {members.map((m, index) => (
            <li key={m.playerId} className="flex items-center gap-2 py-2">
              <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={m.name}>
                {m.name}
              </span>
              <TownHall level={m.thLevel} />
              {action && (
                <form action={action}>
                  <Hidden fields={{ ...hidden, action: "remove", playerId: m.playerId }} />
                  <SubmitButton
                    size="xs"
                    variant="ghost"
                    pendingLabel="Removing"
                    aria-label={`Remove ${m.name} from the ${title} lineup`}
                  >
                    Remove
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ol>
      )}

      {action && (
        <form action={action} className="space-y-2">
          <Hidden fields={{ ...hidden, action: published ? "unpublish" : "publish" }} />
          <SubmitButton
            size="sm"
            variant={published ? "outline" : "default"}
            className="w-full"
            disabled={!published && empty}
            pendingLabel={published ? "Unpublishing" : "Publishing"}
          >
            {published ? "Unpublish (back to draft)" : "Publish lineup to members"}
          </SubmitButton>
          <p className="text-muted-foreground text-center text-xs">
            {published
              ? "Changes you make now are visible to members straight away."
              : empty
                ? "Add at least one player before you can publish."
                : "Members are not told until you publish."}
          </p>
        </form>
      )}

      {children}
    </section>
  );
}

/**
 * The availability chips above a player list: Everyone / Said In / … with counts.
 * Links, not buttons — the filter is URL state (lib/roster-view.ts).
 */
export function AvailabilityChips({
  active,
  counts,
  hrefFor,
}: {
  active: AvailabilityFilter;
  counts: Record<AvailabilityFilter, number>;
  hrefFor: (filter: AvailabilityFilter) => string;
}) {
  return (
    <div role="group" aria-label="Filter by availability" className="flex flex-wrap gap-2">
      {AVAILABILITY_FILTERS.map((filter) => {
        const on = active === filter;
        return (
          <Link
            key={filter}
            href={hrefFor(filter)}
            aria-current={on ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
            }`}
          >
            {AVAILABILITY_LABELS[filter]}{" "}
            <span className={`tabular-nums ${on ? "" : "text-muted-foreground"}`}>{counts[filter]}</span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Search box (and optional "from clan" select) as a plain GET form, so it needs no
 * client code. `hidden` keeps the other URL state across a search.
 */
export function PoolSearch({
  action,
  hidden,
  q,
  clans,
  from,
  clearHref,
}: {
  action: string;
  hidden: Record<string, string>;
  q: string;
  clans?: Array<{ id: string; name: string }>;
  from?: string | null;
  /** Shown as "Clear filters" when set. */
  clearHref?: string | null;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2">
      <Hidden fields={hidden} />
      <div className="relative min-w-48 flex-1">
        <Search
          aria-hidden
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by name or tag"
          aria-label="Search players by name or tag"
          className="pl-9"
        />
      </div>
      {clans && clans.length > 1 && (
        <select
          name="from"
          defaultValue={from ?? ""}
          aria-label="Only players currently in this clan"
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
        >
          <option value="">From all clans</option>
          {clans.map((clan) => (
            <option key={clan.id} value={clan.id}>
              From {clan.name}
            </option>
          ))}
        </select>
      )}
      <Button type="submit" variant="outline">
        Search
      </Button>
      {clearHref && (
        <Button asChild variant="ghost">
          <Link href={clearHref}>Clear filters</Link>
        </Button>
      )}
    </form>
  );
}

/** A numbered step in a "How this works" panel. */
export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
        {n}
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-sm">{children}</span>
      </span>
    </li>
  );
}

/** "How this works", open until the page has something in it. */
export function HowItWorks({ open, children }: { open: boolean; children?: React.ReactNode }) {
  return (
    <details open={open} className="cb-panel rounded-lg border p-5">
      <summary className="cursor-pointer font-medium">How this works</summary>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">{children}</ol>
    </details>
  );
}

// The building blocks of the two roster pages, shared so /roster and
// /roster/[season] say "draft", "published" and "15 slots" the same way.
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

import { CheckCircle2, CircleDashed, CircleHelp, Eye, EyeOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SubmitButton } from "@/components/submit-button";
import { availabilityOf } from "@/lib/roster-view";
import type { Roster, RosterMember } from "@/repositories/rosters";

export function TownHall({ level }: { level: number | null }) {
  return (
    <span
      className="bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums"
      title={level ? `Town Hall ${level}` : "Town Hall not known yet"}
    >
      TH {level ?? "?"}
    </span>
  );
}

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
  status: Roster["status"];
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

/**
 * One clan's lineup: who is in it, how full it is, and publishing.
 *
 * `action` absent means read-only — a member looking at a published lineup.
 * `hidden` carries whatever the page's action needs to put the leader back where
 * they were (season, filters) alongside each form's own fields.
 */
export function LineupPanel({
  roster,
  clanName,
  members,
  action,
  hidden = {},
}: {
  roster: Roster;
  clanName: string;
  members: RosterMember[];
  action?: Action;
  hidden?: Record<string, string>;
}) {
  const published = roster.status === "published";
  const empty = members.length === 0;

  return (
    <section
      aria-label={`${clanName} lineup`}
      className="cb-panel space-y-4 rounded-lg border p-5"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{clanName}</h2>
          <LineupStatus status={roster.status} />
        </div>
        <p className="text-muted-foreground text-xs">
          {published
            ? "Published — members of this clan can see this lineup."
            : "Draft — only leaders and co-leaders can see it until you publish."}
        </p>
        <SlotMeter filled={members.length} slots={roster.slotCount} />
      </div>

      {empty ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          {action
            ? "No players yet. Press Add beside a player in the list to put them in this lineup."
            : "Nobody has been picked for this lineup yet."}
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
                  <Hidden
                    fields={{ ...hidden, action: "remove", rosterId: roster.id, playerId: m.playerId }}
                  />
                  <SubmitButton
                    size="xs"
                    variant="ghost"
                    pendingLabel="Removing"
                    aria-label={`Remove ${m.name} from the ${clanName} lineup`}
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
          <Hidden
            fields={{ ...hidden, action: published ? "unpublish" : "publish", rosterId: roster.id }}
          />
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
    </section>
  );
}

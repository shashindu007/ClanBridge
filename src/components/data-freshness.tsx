// T4.8 — "updated N minutes ago", on every page that shows synced data.
//
// This is how you find out a sync job died before it costs you a season. It is
// deliberately unmissable when it goes wrong and unobtrusive when it does not.
//
// R10 — a "skipped" run is shown as normal, not as a problem. For three weeks of
// every month "not in CWL" is the correct outcome, and an indicator that is
// amber most of the year is an indicator nobody reads on the week it matters.

import Link from "next/link";
import { CircleCheck, CircleDashed, Clock, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Freshness, FreshnessLevel } from "@/services/freshness";

// Every skip reason a job can record, in the words a member would use. An
// unmapped reason falls through to the raw string below, which is readable but
// looks like a leak — so a new skip() belongs here too.
const NOT_IN_CWL: Record<string, string> = {
  noCwlGroup: "not in CWL this month",
  noClansSeeded: "no clans added yet",
  // T6.1. As ordinary as noCwlGroup and for the same reason: most of the time
  // there is no war on, and that is the sync working.
  notInWar: "no war on right now",
};

/**
 * Colour and icon per level.
 *
 * BOTH, always. The badge already carries the words — "updated 4 minutes ago",
 * "failed 2 hours ago" — so the colour is the thing that makes it readable
 * across a room and the icon is what makes it readable to the one man in eight
 * who cannot tell the green one from the red one. Neither is decoration and
 * neither may be dropped to tidy the layout.
 */
const LOOK: Record<
  FreshnessLevel,
  { variant: "success" | "warning" | "destructive" | "outline"; Icon: typeof CircleCheck }
> = {
  fresh: { variant: "success", Icon: CircleCheck },
  // Amber, not red. A stale job MIGHT have died; it might equally be GitHub
  // running a scheduled workflow twenty minutes late, which it does routinely.
  stale: { variant: "warning", Icon: Clock },
  failed: { variant: "destructive", Icon: TriangleAlert },
  // Grey on purpose. "Never run" on a fresh install is the correct state, and
  // a red badge on every page of a clan added an hour ago is a false alarm
  // that teaches the reader to ignore the real one.
  never: { variant: "outline", Icon: CircleDashed },
};

export function DataFreshness({
  freshness,
  canAdmin = false,
}: {
  freshness: Freshness;
  /**
   * Whether this reader can actually do anything about a failure.
   *
   * The failed state used to end "— check /admin" for everybody. An ordinary
   * member who followed that reached a panel reading "This page is for
   * leaders", which is a dead end dressed as an instruction. Architecture §11
   * says the intended mechanism is that "a member will report it before a
   * leader notices" — so the copy now says that to the people it is true of,
   * and keeps the link for the people who can use it.
   *
   * Defaults to false: a caller that has not thought about the role gets the
   * message that is safe for anyone to read.
   */
  canAdmin?: boolean;
}) {
  const { level, label, skipReason } = freshness;
  const { variant, Icon } = LOOK[level];

  if (level === "never") {
    return (
      <Badge variant="outline" className="font-normal">
        <CircleDashed aria-hidden />
        Never synced
      </Badge>
    );
  }

  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      <Badge variant={variant} className="font-normal">
        <Icon aria-hidden />
        {label}
      </Badge>
      {skipReason && <span>{NOT_IN_CWL[skipReason] ?? skipReason}</span>}
      {level === "stale" && <span>— the sync job may have stopped</span>}
      {level === "failed" &&
        (canAdmin ? (
          <span>
            —{" "}
            <Link href="/admin" className="underline underline-offset-2">
              check /admin
            </Link>
          </span>
        ) : (
          // Named in words a member can act on, and no route they cannot open.
          // "Game data" rather than "the sync job": a member does not know what
          // a sync job is and cannot run one.
          <span>— tell your clan leader; game data has stopped updating</span>
        ))}
    </span>
  );
}

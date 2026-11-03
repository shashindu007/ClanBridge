// One clan on Home: its badge, what it is doing right now, and what you owe it.
//
// The home page used to show ONE clan at a time, behind tabs, and the thing a
// member most needs — "is a war on, and do I still have an attack?" — sat in the
// middle of a card below a to-do list. A member in four clans had to click four
// tabs to find out. Now every clan is a tile, all visible at once, and each
// answers three questions in the order they are asked:
//
//   1. What is happening?        the ribbon: WAR · 12h, CWL DAY 3, PREP, NO WAR
//   2. What do I need to do?     one big line — "2 attacks left" — with the
//                                button that does it, or "All attacks used"
//   3. What is this clan?        its name, your role, members and league
//
// LEAN ON PURPOSE. Home is where a member tracks their OWN bases now, so the
// base card above carries Town Hall, rank and Base details, and the village
// line that used to repeat them here is gone — as are the tag and the clan
// level, which nobody acts on from Home. The clan's latest notice (pinned
// first, as the clan page chooses) shows only when there IS one: a row saying
// "No announcements yet" on every clan was noise, and the Announcements feed
// below covers "anything new?".
//
// Two zones side by side — who, and what is happening — that stack on a phone;
// the page lays two rows per line on a wide screen.
//
// The whole row opens the clan (the same page the Clans menu opens — the tabs'
// ?clan= links, which went somewhere else under the same name, are gone). The
// controls inside carry `relative z-10` to rise above that one link, the same
// pattern as Tile in kit.tsx.
//
// GOLD AT MOST ONCE. The page decides which single tile, if any, gets the gold
// "Attack" — the first clan where you still have one — and says so with `gold`.

import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Flag,
  Megaphone,
  Pin,
  Swords,
  Trophy,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { FactRow } from "@/components/kit";
import { ClanBadge } from "@/components/game/clan-badge";
import { GameArt } from "@/components/game/game-art";
import { Ribbon } from "@/components/game/ribbon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { artKeyForLeague } from "@/lib/game-art";
import { timeAgo, type ClanStatus, type StatusKind } from "@/services/home";
import type { Freshness } from "@/services/freshness";

const RIBBON_ICON: Partial<Record<StatusKind, LucideIcon>> = {
  cwl: Trophy,
  war: Swords,
  "cwl-prep": CalendarClock,
  prep: CalendarClock,
  signup: ClipboardList,
  result: Flag,
};

export interface ClanTileClan {
  id: string;
  tag: string;
  name: string;
  role: string;
  badgeUrl: string | null;
  /** From clanAccent(): the top band and the badge's fallback shield. */
  color: string;
}

/** The clan's latest notice, pinned first. */
export interface ClanTileNotice {
  title: string;
  pinned: boolean;
  createdAt: string;
}

export function ClanStatusTile({
  clan,
  status,
  memberCount,
  warLeague,
  fresh,
  gold,
  clanLeft,
  notice = null,
  now = new Date(),
}: {
  clan: ClanTileClan;
  status: ClanStatus;
  memberCount: number;
  warLeague: string | null;
  fresh: Freshness;
  /** This tile carries the page's one gold call to action. */
  gold: boolean;
  /** Everyone's unused attacks in the live war — only passed for clans the caller helps run. */
  clanLeft: number | null;
  /** Shown only when there is one. */
  notice?: ClanTileNotice | null;
  /** For "3h ago". The page passes its own, so every tile agrees. */
  now?: Date;
}) {
  const behind = fresh.level === "stale" || fresh.level === "failed";
  const leagueKey = artKeyForLeague(warLeague);

  return (
    <li className="cb-panel cb-panel-interactive relative overflow-hidden rounded-panel border">
      {/* The clan's colour, as an edge rather than a band: a row reads left
          to right, so that is where its owner's mark goes. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: clan.color }} />
      {/* One link for the whole row; the controls inside rise above it. */}
      <Link
        href={`/${encodeURIComponent(clan.tag)}`}
        aria-label={`Open ${clan.name}`}
        className="focus-visible:ring-ring/50 absolute inset-0 z-[1] rounded-panel outline-none focus-visible:ring-[3px]"
      />

      <div className="grid gap-x-5 gap-y-3 py-3 pr-3 pl-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:pr-4">
        {/* Who: the clan, your role, and two facts. */}
        <div className="flex min-w-0 items-center gap-3">
          <ClanBadge src={clan.badgeUrl} name={clan.name} size="lg" tone={clan.color} priority />
          <div className="min-w-0 space-y-0.5">
            <p className="flex min-w-0 items-baseline gap-2">
              <span className="cb-title truncate text-lg leading-tight">{clan.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs capitalize">{clan.role}</span>
            </p>
            <FactRow
              className="gap-x-3 gap-y-0.5 text-xs"
              items={[
                { label: memberCount === 1 ? "member" : "members", value: memberCount, icon: Users },
                ...(warLeague
                  ? [
                      {
                        label: "league",
                        value: warLeague.replace(/ League/, ""),
                        title: warLeague,
                        art: (
                          <GameArt
                            art={leagueKey}
                            size={16}
                            alt=""
                            fallback={<Trophy aria-hidden className="text-muted-foreground size-3.5" />}
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            {behind && (
              <Badge variant="warning" title={`Game data ${fresh.label} — numbers here may be out of date.`}>
                <TriangleAlert aria-hidden />
                Data {fresh.label}
              </Badge>
            )}
          </div>
        </div>

        {/* What is happening, and what you owe it. */}
        <div className="min-w-0 space-y-1.5">
          <Ribbon tone={status.tone} icon={RIBBON_ICON[status.kind]}>
            {status.label}
          </Ribbon>
          <Action status={status} gold={gold} clanLeft={clanLeft} />
        </div>

        {/* The latest notice — only when there is one. */}
        {notice && (
          <Link
            href={`/${encodeURIComponent(clan.tag)}/notices`}
            className="cb-sunken hover:bg-accent/50 relative z-10 flex min-w-0 items-center gap-2.5 rounded-control px-3 py-1.5 text-sm sm:col-span-2"
          >
            {notice.pinned ? (
              <Pin aria-label="Pinned" className="text-info-ink size-4 shrink-0" />
            ) : (
              <Megaphone aria-hidden className="text-muted-foreground size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{notice.title}</span>
            <span className="text-muted-foreground shrink-0 text-xs">{timeAgo(notice.createdAt, now)}</span>
            <ChevronRight aria-hidden className="text-muted-foreground -mr-1 size-3.5 shrink-0" />
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * The one line that says what you should do, and the button that does it.
 * Every branch says something in words — "Not in this war" is an answer too.
 */
function Action({
  status,
  gold,
  clanLeft,
}: {
  status: ClanStatus;
  gold: boolean;
  clanLeft: number | null;
}) {
  const battle = status.kind === "war" || status.kind === "cwl";
  const { mine } = status;

  if (battle && mine && mine.left > 0) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="leading-tight">
          <span className="cb-title text-2xl tabular-nums">{mine.left}</span>{" "}
          <span className="text-sm font-medium">
            {mine.left === 1 ? "attack" : "attacks"} left
          </span>
        </p>
        <Button asChild variant={gold ? "gold" : "outline"} size="sm" className="relative z-10">
          <Link href={status.href}>
            <Swords aria-hidden />
            Attack
          </Link>
        </Button>
      </div>
    );
  }

  if (battle && mine) {
    return (
      <p className="text-success-ink flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 aria-hidden className="size-4.5" />
        All {mine.allowed === 1 ? "your attack" : `${mine.allowed} attacks`} used
      </p>
    );
  }

  const line = (() => {
    switch (status.kind) {
      case "war":
      case "cwl":
        return clanLeft ? `Not in this war · ${clanLeft} unused in the clan` : "Not in this war";
      case "prep":
        return mine ? "You are in this war" : "Preparation day — not in this war";
      case "cwl-prep":
        return "League war preparation day";
      case "signup":
        return "CWL sign-up is open";
      case "result":
        return "Last war ended in the past day";
      default:
        return "No war on right now";
    }
  })();

  return <p className="text-muted-foreground text-sm">{line}</p>;
}

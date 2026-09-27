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
//   3. What is this clan?        a line of facts: members, level, league
//
// And, between the action and the facts, two things a member used to open
// other pages for: THEIR village in this clan (Town Hall, straight to its
// base details) and the clan's latest notice — pinned first, the same choice
// the clan page makes. Both optional: a leader may have no village here, and
// a clan may have posted nothing.
//
// The whole tile opens the clan (the same page the Clans menu opens — the tabs'
// ?clan= links, which went somewhere else under the same name, are gone). The
// action button inside rises above that link; see Tile in kit.tsx.
//
// GOLD AT MOST ONCE. The page decides which single tile, if any, gets the gold
// "Attack" — the first clan where you still have one — and says so with `gold`.

import Link from "next/link";
import {
  CalendarClock,
  Castle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Flag,
  Megaphone,
  Pin,
  Shield,
  Swords,
  Trophy,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { FactRow, Tile } from "@/components/kit";
import { ClanBadge } from "@/components/game/clan-badge";
import { GameArt } from "@/components/game/game-art";
import { Ribbon } from "@/components/game/ribbon";
import { TownHall } from "@/components/game/town-hall";
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

/** The caller's own village in this clan. */
export interface ClanTileVillage {
  label: string;
  thLevel: number | null;
  /** Its Base details page. */
  href: string;
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
  level,
  warLeague,
  fresh,
  gold,
  clanLeft,
  village = null,
  notice = null,
  now = new Date(),
}: {
  clan: ClanTileClan;
  status: ClanStatus;
  memberCount: number;
  level: number | null;
  warLeague: string | null;
  fresh: Freshness;
  /** This tile carries the page's one gold call to action. */
  gold: boolean;
  /** Everyone's unused attacks in the live war — only passed for clans the caller helps run. */
  clanLeft: number | null;
  village?: ClanTileVillage | null;
  notice?: ClanTileNotice | null;
  /** For "3h ago". The page passes its own, so every tile agrees. */
  now?: Date;
}) {
  const behind = fresh.level === "stale" || fresh.level === "failed";
  const leagueKey = artKeyForLeague(warLeague);

  return (
    <Tile
      as="li"
      accent={clan.color}
      art={<ClanBadge src={clan.badgeUrl} name={clan.name} size="xl" tone={clan.color} priority />}
      ribbon={
        <Ribbon tone={status.tone} icon={RIBBON_ICON[status.kind]}>
          {status.label}
        </Ribbon>
      }
      href={`/${encodeURIComponent(clan.tag)}`}
      label={`Open ${clan.name}`}
      className="flex flex-col gap-4"
    >
      <div className="min-w-0">
        <p className="cb-title truncate text-xl leading-tight">{clan.name}</p>
        <p className="text-muted-foreground text-xs">
          <span className="font-mono">{clan.tag}</span> · <span className="capitalize">{clan.role}</span>
        </p>
      </div>

      <Action status={status} gold={gold} clanLeft={clanLeft} />

      <div className="cb-sunken divide-border/60 divide-y rounded-control text-sm">
        {village && (
          <Link
            href={village.href}
            className="hover:bg-accent/50 relative z-10 flex items-center gap-2.5 rounded-control px-3 py-2"
          >
            <TownHall level={village.thLevel} size="xs" />
            <span className="min-w-0 flex-1 truncate font-medium">{village.label}</span>
            <span className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium">
              <Castle aria-hidden className="size-3.5" />
              Base details
            </span>
          </Link>
        )}
        {notice ? (
          <Link
            href={`/${encodeURIComponent(clan.tag)}/notices`}
            className="hover:bg-accent/50 relative z-10 flex items-center gap-2.5 rounded-control px-3 py-2"
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
        ) : (
          <p className="text-muted-foreground flex items-center gap-2.5 px-3 py-2 text-xs">
            <Megaphone aria-hidden className="size-4 shrink-0" />
            No announcements yet
          </p>
        )}
      </div>

      <div className="mt-auto space-y-2 border-t pt-3">
        <FactRow
          className="gap-x-4 text-[0.8125rem]"
          items={[
            { label: memberCount === 1 ? "member" : "members", value: memberCount, icon: Users },
            ...(level ? [{ label: "level", value: level, icon: Shield }] : []),
            ...(warLeague
              ? [
                  {
                    label: "league",
                    value: warLeague.replace(/ League/, ""),
                    title: warLeague,
                    art: (
                      <GameArt
                        art={leagueKey}
                        size={20}
                        alt=""
                        fallback={<Trophy aria-hidden className="text-muted-foreground size-4" />}
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
    </Tile>
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
          <span className="cb-title text-3xl tabular-nums">{mine.left}</span>{" "}
          <span className="text-sm font-medium">
            {mine.left === 1 ? "attack" : "attacks"} left
          </span>
        </p>
        <Button asChild variant={gold ? "gold" : "outline"} size={gold ? "cta" : "default"} className="relative z-10">
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

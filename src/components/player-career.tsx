// 065 — a village's career and achievements, as the game's own profile screen
// has them. Shared by [clanTag]/player/[tag] and /account/bases/[tag], the
// same way player-report-sections.tsx is, so the two pages cannot drift.
//
// A SERVER COMPONENT. Most of these are lifetime totals and two are this season's,
// all from the daily player sync, so each tile says which it is: "1,240 war stars"
// beside a season's table reads as this season unless told otherwise.

import { Award, Coins, Hammer, Medal, Shield, Star, Swords, Trophy } from "lucide-react";
import { Disclosure, StatTile } from "@/components/kit";
import { LocalTime } from "@/components/local-time";
import { Stars } from "@/components/stars";
import type { PlayerProfileRow } from "@/repositories/profiles";
import type { Achievement } from "@/types/domain";

function number(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-GB");
}

export function PlayerCareer({
  profile,
  departed = false,
}: {
  profile: PlayerProfileRow | null;
  /** They have left this clan. The daily sync reads current members and linked villages only. */
  departed?: boolean;
}) {
  if (!profile) {
    return (
      <section className="cb-panel space-y-2 rounded-panel border p-5">
        <h2 className="text-lg font-semibold">Career</h2>
        <p className="text-muted-foreground text-sm">
          {departed
            ? "Not read. Lifetime war stars, Capital Gold and achievements are read for current members, and this player has left the clan."
            : "Not read yet. Lifetime war stars, Capital Gold and achievements arrive with the daily player sync, so this fills in by itself within a day."}
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="cb-panel space-y-4 rounded-panel border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Career</h2>
          <p className="text-muted-foreground text-xs">
            From the game · read <LocalTime iso={profile.capturedAt} style="date" />
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="War stars" icon={Star} value={number(profile.warStars)} sub="lifetime, wars and CWL" />
          <StatTile
            label="Capital Gold given"
            icon={Coins}
            value={number(profile.capitalContributions)}
            sub="lifetime, to the Clan Capital"
          />
          <StatTile label="Best trophies" icon={Trophy} value={number(profile.bestTrophies)} sub="all-time, home village" />
          <StatTile
            label="Attacks won"
            icon={Swords}
            value={number(profile.attackWins)}
            sub="this season, multiplayer"
          />
          <StatTile
            label="Defences won"
            icon={Shield}
            value={number(profile.defenseWins)}
            sub="this season, multiplayer"
          />
          <StatTile
            label="Builder Base best"
            icon={Hammer}
            value={number(profile.bestBuilderBaseTrophies)}
            sub={profile.builderBaseTrophies === null ? "trophies" : `${number(profile.builderBaseTrophies)} now`}
          />
        </div>

        {(profile.expLevel !== null || profile.warPreference !== null) && (
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {profile.expLevel !== null && (
              <span className="flex items-center gap-1.5">
                <Medal aria-hidden className="size-4" />
                Experience level <span className="text-foreground font-medium tabular-nums">{profile.expLevel}</span>
              </span>
            )}
            {profile.warPreference !== null && (
              <span className="flex items-center gap-1.5">
                <Swords aria-hidden className="size-4" />
                War preference{" "}
                <span className="text-foreground font-medium capitalize">{profile.warPreference}</span>
              </span>
            )}
          </p>
        )}
      </section>

      <Achievements achievements={profile.achievements} />
    </>
  );
}

/** Home village first, then the Builder Base and the Clan Capital — the game's order. */
function Achievements({ achievements }: { achievements: Achievement[] }) {
  if (!achievements.length) return null;

  const complete = achievements.filter((a) => a.stars >= 3).length;
  const groups: Array<[string, Achievement[]]> = [
    ["Home village", achievements.filter((a) => a.village === "home")],
    ["Builder Base", achievements.filter((a) => a.village === "builder")],
    ["Clan Capital", achievements.filter((a) => a.village === "capital")],
  ];

  return (
    <Disclosure
      title="Achievements"
      icon={Award}
      count={achievements.length}
      summary={
        <span className="text-muted-foreground text-sm tabular-nums">
          {complete} of {achievements.length} with three stars
        </span>
      }
    >
      <div className="space-y-5">
        {groups
          .filter(([, list]) => list.length)
          .map(([label, list]) => (
            <div key={label} className="space-y-2">
              <h3 className="text-muted-foreground text-xs font-medium uppercase">{label}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((a) => (
                  <AchievementRow key={a.name} achievement={a} />
                ))}
              </ul>
            </div>
          ))}
      </div>
    </Disclosure>
  );
}

function AchievementRow({ achievement: a }: { achievement: Achievement }) {
  const done = a.stars >= 3;
  // The target is the NEXT star's goal; at three stars it is the last one met.
  const pct = done || !a.target ? 100 : Math.min(100, (a.value / a.target) * 100);

  return (
    <li className="cb-sunken space-y-1.5 rounded-control p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">{a.name}</p>
        <Stars stars={a.stars} />
      </div>
      {a.info && <p className="text-muted-foreground text-xs">{a.info}</p>}
      <div
        className="cb-gauge h-1.5"
        role="img"
        aria-label={done ? "Complete" : `${Math.round(pct)}% of the way to the next star`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted-foreground text-xs tabular-nums">
        {a.value.toLocaleString("en-GB")}
        {!done && a.target ? ` of ${a.target.toLocaleString("en-GB")}` : ""}
      </p>
    </li>
  );
}

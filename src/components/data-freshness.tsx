// T4.8 — "updated N minutes ago", on every page that shows synced data.
//
// This is how you find out a sync job died before it costs you a season. It is
// deliberately unmissable when it goes wrong and unobtrusive when it does not.
//
// R10 — a "skipped" run is shown as normal, not as a problem. For three weeks of
// every month "not in CWL" is the correct outcome, and an indicator that is
// amber most of the year is an indicator nobody reads on the week it matters.

import { Badge } from "@/components/ui/badge";
import type { Freshness } from "@/services/freshness";

const NOT_IN_CWL: Record<string, string> = {
  noCwlGroup: "not in CWL this month",
  noClansSeeded: "no clans added yet",
};

export function DataFreshness({ freshness }: { freshness: Freshness }) {
  const { level, label, skipReason } = freshness;

  if (level === "never") {
    return (
      <Badge variant="outline" className="font-normal">
        Never synced
      </Badge>
    );
  }

  const variant =
    level === "failed" ? "destructive" : level === "stale" ? "secondary" : "outline";

  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      <Badge variant={variant} className="font-normal">
        {label}
      </Badge>
      {skipReason && <span>{NOT_IN_CWL[skipReason] ?? skipReason}</span>}
      {level === "stale" && <span>— the sync job may have stopped</span>}
      {level === "failed" && <span>— check /admin</span>}
    </span>
  );
}

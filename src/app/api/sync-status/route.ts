// GET /api/sync-status?target=war&clan=%23TAG — the one question a live page asks
// every minute: has new data landed since I was rendered?
//
// Deliberately tiny. The alternative — router.refresh() on a timer — re-renders
// the whole war board, a dozen queries, for every open tab every minute, almost
// always to produce the same page. This is one indexed read of sync_log, and the
// page re-renders only when the answer changes.
//
// R1: reads PostgreSQL only. RLS scopes sync_log to the caller's clans plus the
// global rows (006), and the clan is resolved through visibleClans() so a tag
// the caller cannot see is a 404 rather than an answer.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { decodeTag } from "@/lib/tags";
import { latestRun, runningSince } from "@/repositories/sync-log";
import { SYNC_TARGETS, isSyncTarget } from "@/services/sync-now";

export const dynamic = "force-dynamic";

export interface SyncStatus {
  /** When the watched job last finished — compare with what the page rendered. */
  finishedAt: string | null;
  /** When a run of this workflow started, if one is under way now. */
  runningSince: string | null;
}

function fail(status: number, error: string): Response {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const target = params.get("target") ?? "";
  if (!isSyncTarget(target)) return fail(400, "unknown target");

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return fail(401, "signed out");

  let tag: string;
  try {
    tag = decodeTag(params.get("clan") ?? "");
  } catch {
    return fail(404, "unknown clan");
  }
  const clan = (await visibleClans(supabase, userId)).find((c) => c.tag === tag);
  if (!clan) return fail(404, "unknown clan");

  const { jobs, watch } = SYNC_TARGETS[target];
  const [run, ...running] = await Promise.all([
    latestRun(supabase, watch, clan.id),
    ...jobs.map((job) => runningSince(supabase, job, clan.id)),
  ]);

  const body: SyncStatus = {
    finishedAt: run?.finishedAt ?? null,
    runningSince: running.find((r) => r !== null) ?? null,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

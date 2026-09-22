// Root route — the public landing page, or a router into the app.
//
//   no session       -> the landing page, rendered here (T12.5)
//   pending account  -> /pending    (T3.8)
//   otherwise        -> /dashboard  (T12.6)
//
// T12.5 — "/" USED TO BE A REDIRECT FOR EVERYONE. An anonymous visitor was
// bounced to /login by middleware without ever learning what the site was.
// The middleware now lets "/" through by EXACT match only (PUBLIC_EXACT_PATHS
// in lib/supabase/middleware.ts), so this page decides.
//
// T12.6 — members now land on a home dashboard rather than on whichever clan
// sorts first by tag. The old "no clans → /admin" branch moved INTO the
// dashboard, which shows a platform owner with no clans an "add your first
// clan" prompt instead of dropping them on a settings page.
//
// R1 — reads the database only, through 042's two anon-callable functions.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accountStatus, currentUserId } from "@/lib/auth";
import { publicFeedback, publicStats } from "@/repositories/feedback";
import { Landing } from "@/components/landing/landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ClanBridge — your clan's record, kept",
  description:
    "Wars, Clan War League seasons, rosters, polls and notices for every clan in the family — kept for good, even after the game deletes them.",
  openGraph: {
    title: "ClanBridge — your clan's record, kept",
    description:
      "Wars, league seasons, rosters and polls for Clash of Clans clans, in one place that does not get buried in chat.",
    type: "website",
  },
};

export default async function HomePage() {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);

  if (!userId) {
    const [stats, quotes] = await Promise.all([
      publicStats(supabase),
      publicFeedback(supabase, 6),
    ]);
    return <Landing stats={stats} quotes={quotes} />;
  }

  const status = await accountStatus(supabase, userId);
  if (status !== "approved") redirect("/pending");

  redirect("/dashboard");
}

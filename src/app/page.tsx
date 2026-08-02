// Root route — a router, not a page.
//
//   no session       -> /login      (handled upstream by the middleware, T3.2)
//   pending account  -> /pending    (T3.8)
//   platform admin, no clans yet -> /admin   (first-run bootstrap)
//   otherwise        -> the user's first clan (T3.6)
//
// R1 — reads the database only. R3 — the clan list comes from the user's own
// clan_roles via visibleClans(), never from a hardcoded list of three.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accountStatus, currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";

export default async function HomePage() {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const status = await accountStatus(supabase, userId);
  if (status !== "approved") redirect("/pending");

  const clans = await visibleClans(supabase, userId);

  // An approved user with no clan is the platform owner immediately after
  // claiming ownership, before any clan has been added. /admin is where they add
  // the first one.
  if (clans.length === 0) redirect("/admin");

  redirect(`/${encodeURIComponent(clans[0]!.tag)}`);
}

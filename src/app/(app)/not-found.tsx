// The 404 inside the authenticated shell.
//
// WHY THIS FILE HAS TO EXIST, and why its absence was not a cosmetic gap.
//
// requireClanByTag() ends in notFound(), and every one of the pages under
// [clanTag] calls it — so a mistyped tag, a link into a clan the member holds no
// role in, and a stale bookmark all arrive here. Twenty more call sites cover
// players, polls, seasons and bases. Without this file every one of them
// rendered Next's built-in 404, which is served OUTSIDE (app)/layout.tsx: no clan
// switcher, no section tabs, no account menu. A member who tapped a leader's
// link in WhatsApp got a bare white page and the browser's back button.
//
// The reasoning is the one already written at the top of (app)/loading.tsx —
// "one boundary here covers all 33 pages" — applied to the case that file did
// not cover. A per-page 404 would be 33 files to keep in step; this is the
// version that stays true.
//
// R3 — IT DELIBERATELY SAYS NOTHING ABOUT WHAT WAS ASKED FOR. requireClanByTag
// answers "you may not see this" and "there is no such clan" identically and on
// purpose, because distinguishing them would leak which tags are real. This page
// must not undo that: it names no tag, confirms no clan's existence, and offers
// the member their own clans instead. Listing those is safe — visibleClans() is
// the member's own clan_roles, which is what the rail already shows them.

import Link from "next/link";
import { Compass, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { clanAccent } from "@/lib/clan-accent";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppNotFound() {
  // A 404 must never become a 500. Everything below is decoration on top of the
  // apology, so a failed lookup degrades to the apology alone rather than
  // throwing inside an error path — which is how a missing page turns into an
  // unstyled crash.
  let clans: Awaited<ReturnType<typeof visibleClans>> = [];
  try {
    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (userId) clans = await visibleClans(supabase, userId);
  } catch {
    clans = [];
  }

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <div className="cb-panel space-y-4 rounded-panel border p-5 sm:p-8">
        <span
          className="cb-emblem size-11 rounded-control"
          style={{ "--emblem": "var(--primary)" } as React.CSSProperties}
        >
          <Compass aria-hidden className="size-5" />
        </span>

        <div className="space-y-2">
          <h1 className="cb-title text-3xl">
            That page is not here
          </h1>
          {/* Both causes, because the member cannot tell them apart and neither
              can we tell them which it was. Worded so that neither reads as an
              accusation: a stale link is the likeliest cause by far. */}
          <p className="text-muted-foreground text-sm">
            Either the link is wrong or out of date, or it points at a clan you are
            not a member of. Links into a clan only work for people in it, so a
            link that works for the person who sent it can still fail for you.
          </p>
        </div>

        {clans.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {clans.length === 1 ? "Your clan" : "Your clans"}
            </p>
            <div className="flex flex-wrap gap-2">
              {clans.map((clan) => (
                <Button key={clan.id} asChild size="sm" variant="outline">
                  <Link href={`/${encodeURIComponent(clan.tag)}`}>
                    {/* The same derived hue the rail uses, so a member
                        recognises the clan by the dot they already know. */}
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: clanAccent(clan.id).color }}
                    />
                    {clan.name}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button asChild size="sm">
            <Link href="/">Go to my dashboard</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/guide">
              <LifeBuoy aria-hidden />
              Help
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

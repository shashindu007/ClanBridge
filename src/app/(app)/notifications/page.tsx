// T12.3 — everything this system has told you, where the bell now leads.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS PAGE HAD TO EXIST
//
// The bell in the shell pointed at /settings/notifications, which is the
// PREFERENCES page. A member could configure which notifications to receive and
// had nowhere at all to read one — and since a notification was only ever a Web
// Push, anything sent while they had no subscription reached nobody and left no
// trace. This is the other half: 040 stores every notification, and this is
// where they are read.
//
// ONE FEED, NOT TWO. T12.2 briefly shipped a separate /messages inbox with its
// own Mail icon and its own count, which would have meant a shell showing a bell
// at 3 beside an envelope at 1 for the same question — "is there anything I
// have not seen". Direct messages are a KIND here, not a second place.
//
// Not gate-exempt (lib/gate.ts): an unapproved account has no clan role, so
// nothing can be addressed to it, and /pending explains that state better than
// an empty feed would.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BellOff,
  CheckCheck,
  Mail,
  Megaphone,
  Settings,
  Swords,
  TriangleAlert,
  Trophy,
  Vote,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { feedFor, markAllRead, markRead } from "@/repositories/notifications";
import { LocalTime } from "@/components/local-time";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * How each kind reads, and what it looks like.
 *
 * Keyed by the same vocabulary as notification_preferences' columns and
 * NotificationKind in lib/push.ts. `sync_alerts` has no preference column on
 * purpose — scripts/sync/alerts.ts explains why an operational alert is not
 * something a platform admin may mute — so it appears here and not there.
 *
 * An unrecognised kind falls through to the generic entry rather than throwing.
 * A migration can add a kind without this file, and a feed that 500s because it
 * met a word it did not know would be a worse failure than a grey icon.
 */
const KINDS: Record<string, { label: string; Icon: typeof Mail }> = {
  direct_messages: { label: "Message from leadership", Icon: Mail },
  announcements: { label: "Announcement", Icon: Megaphone },
  cwl_reminders: { label: "CWL", Icon: Trophy },
  war_reminders: { label: "War", Icon: Swords },
  raid_reminders: { label: "Raids", Icon: Swords },
  poll_reminders: { label: "Poll", Icon: Vote },
  sync_alerts: { label: "Sync", Icon: TriangleAlert },
};

const GENERIC = { label: "Notification", Icon: Megaphone };

async function markOneRead(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/notifications");

  // mark_notification_read() (040) checks that the row is the caller's own, so
  // a forged id changes nothing and there is no authority for this file to
  // check.
  await markRead(supabase, id);

  revalidatePath("/notifications");
  redirect("/notifications");
}

async function clearAll() {
  "use server";

  const supabase = await createClient();
  const cleared = await markAllRead(supabase);

  revalidatePath("/notifications");
  redirect(cleared > 0 ? "/notifications?ok=notifications-cleared" : "/notifications");
}

export default async function NotificationsPage() {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const feed = await feedFor(supabase, userId);
  const unread = feed.filter((n) => !n.readAt).length;

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Notifications"
        description="Everything this app has told you, kept. Nothing here depends on your phone having been switched on at the time."
      />

      <div className="flex flex-wrap items-center gap-3">
        {unread > 0 && (
          <>
            <p className="text-sm font-medium">
              {unread === 1 ? "1 unread" : `${unread} unread`}
            </p>
            <form action={clearAll}>
              <SubmitButton size="sm" variant="outline" pendingLabel="Clearing">
                <CheckCheck aria-hidden />
                Mark all as read
              </SubmitButton>
            </form>
          </>
        )}
        {/* The preferences page, which is where the bell used to go. Kept one
            click away rather than removed — a member whose feed is noisy is
            exactly the member who wants it. */}
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link href="/settings/notifications">
            <Settings aria-hidden />
            Settings
          </Link>
        </Button>
      </div>

      {feed.length === 0 ? (
        <div className="rounded-panel border border-dashed p-8 text-center">
          <BellOff aria-hidden className="text-muted-foreground mx-auto size-6" />
          <p className="mt-2 text-sm font-medium">Nothing yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Announcements, war and CWL reminders, and anything a leader sends you
            directly will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {feed.map((item) => {
            const { label, Icon } = KINDS[item.kind] ?? GENERIC;

            return (
              <li
                key={item.id}
                // Unread carries the weight, because they are the reason
                // somebody opened this page.
                className={`cb-panel space-y-3 rounded-panel border p-5 ${
                  item.readAt ? "" : "border-info/40 shadow-sm"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground text-xs uppercase">{label}</p>
                    <h2 className="text-base font-semibold">{item.title}</h2>
                  </div>
                  {!item.readAt && <Badge variant="info">New</Badge>}
                  <span className="text-muted-foreground text-xs">
                    <LocalTime iso={item.createdAt} />
                  </span>
                </div>

                {/* whitespace-pre-wrap: a leader writing a message uses line
                    breaks to separate points, and collapsing them turns three
                    things into one long sentence. */}
                <p className="text-sm whitespace-pre-wrap">{item.body}</p>

                <div className="flex flex-wrap gap-2">
                  {/* Only when the link goes somewhere. Every notification has
                      a url, and for a direct message it is this page — a "Go
                      to" button that reloads the page you are on is a button
                      that looks broken. */}
                  {item.url !== "/notifications" && item.url !== "/" && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={item.url}>Go to it</Link>
                    </Button>
                  )}
                  {!item.readAt && (
                    <form action={markOneRead}>
                      <input type="hidden" name="id" value={item.id} />
                      <SubmitButton size="sm" variant="ghost" pendingLabel="Marking">
                        Mark as read
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

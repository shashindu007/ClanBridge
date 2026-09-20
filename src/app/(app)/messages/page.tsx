// T12.2 — the member's side of a message from leadership.
//
// The reason this page exists rather than the message being only a push
// notification: push is best-effort by nature. It is a no-op with no VAPID keys
// configured, a no-op for a member who never granted permission, and lib/push.ts
// swallows every delivery failure on purpose so that a notification can never
// take down the write it accompanies. That is right for "the roster is
// published" and wrong for "stop doing this or you lose your account".
//
// So the row in account_messages IS the message, and this is where it is read.
// The notification is a doorbell that may or may not ring.
//
// NOT gate-exempt (lib/gate.ts): an unapproved account has no messages, because
// nothing can be sent to it until a leader can see it, and /pending already
// explains that state better than an empty inbox would.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Inbox, MailOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { inboxMessages, markMessageRead } from "@/repositories/accounts";
import { LocalTime } from "@/components/local-time";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Marking one read.
 *
 * DELIBERATELY A BUTTON AND NOT AN AUTOMATIC READ ON RENDER. The unread badge is
 * what makes a member open this page at all, and clearing it simply because the
 * page was rendered means a message glanced at on a locked phone is
 * indistinguishable from one that was read and acted on. The leader sees that
 * flag too — /admin/members shows whether a warning landed — so it has to mean
 * something.
 */
async function markRead(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const messageId = String(formData.get("messageId") ?? "");
  if (!messageId) redirect("/messages");

  // mark_message_read() (039) checks that the message is the caller's own, so a
  // forged id changes nothing and there is no authority for this file to check.
  await markMessageRead(supabase, messageId);

  revalidatePath("/messages");
  redirect("/messages?ok=message-read");
}

export default async function MessagesPage() {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const messages = await inboxMessages(supabase, userId);
  const unread = messages.filter((m) => !m.readAt).length;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <PageHeader
        title="Messages"
        description="Messages your clan leadership has sent to you. They are kept here — nothing disappears when a notification does."
      />

      {messages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Inbox aria-hidden className="text-muted-foreground mx-auto size-6" />
          <p className="mt-2 text-sm font-medium">No messages</p>
          <p className="text-muted-foreground mt-1 text-sm">
            If a leader writes to you directly, it appears here.
          </p>
        </div>
      ) : (
        <>
          {unread > 0 && (
            <p className="text-sm">
              <strong>{unread === 1 ? "1 unread message" : `${unread} unread messages`}</strong>
            </p>
          )}

          <ul className="space-y-3">
            {messages.map((message) => (
              <li
                key={message.id}
                // The unread ones are the point of the page, so they carry the
                // weight rather than being distinguished by a dot somewhere.
                className={`cb-panel space-y-3 rounded-lg border p-5 ${
                  message.readAt ? "" : "border-info/40 shadow-sm"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{message.subject}</h2>
                  {!message.readAt && <Badge variant="info">New</Badge>}
                  <span className="text-muted-foreground ml-auto text-xs">
                    <LocalTime iso={message.createdAt} />
                  </span>
                </div>

                {/* whitespace-pre-wrap: a leader typing a message uses line
                    breaks to separate points, and collapsing them turns a list
                    of three things into one long sentence. */}
                <p className="text-sm whitespace-pre-wrap">{message.body}</p>

                {!message.readAt && (
                  <form action={markRead}>
                    <input type="hidden" name="messageId" value={message.id} />
                    <SubmitButton size="sm" variant="outline" pendingLabel="Marking">
                      <MailOpen aria-hidden />
                      Mark as read
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

// T12.2 — one account, and the three things leadership can do about it.
//
// The screen a leader had no way to reach before this phase. /admin/members
// lists accounts; this is the account itself: who they are, which clans and
// villages are theirs, what has already been said to them, and the two acts
// that change something — a message, and taking access away.
//
// R3 — every mutation here is authorised by the DATABASE, not by this file.
// send_account_message(), remove_account() and restore_account() (039) each run
// auth_may_administer_account() before touching anything and write their own
// audit_log row in the same transaction. The checks below decide what to
// RENDER; a Server Action is independently addressable and must never rely on
// the page around it having done the check.
//
// R4 — "Remove access" is not a delete. The row stays, the villages stay
// claimed, the audit entry keeps the reason, and Restore puts the account back
// in the approval queue. The wording on this page says so, because a button
// labelled Delete that does not delete is worse than either.

import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Castle, Mail, ShieldAlert, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { notifyUsers } from "@/lib/push";
import { LocalTime } from "@/components/local-time";
import {
  adminAccount,
  removeAccount,
  restoreAccount,
  sendAccountMessage,
  type AdminAccount,
} from "@/repositories/accounts";
import { sentTo } from "@/repositories/notifications";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

/** The longest body 039's check constraint accepts. Restated so the form can say so first. */
const BODY_LIMIT = 2000;

async function sendMessage(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const target = String(formData.get("userId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const back = `/admin/members/${target}`;

  if (!target) redirect("/admin/members?error=bad-request");
  if (!subject) redirect(`${back}?error=no-subject`);
  if (!body) redirect(`${back}?error=no-body`);
  if (body.length > BODY_LIMIT) redirect(`${back}?error=message-too-long`);

  const id = await sendAccountMessage(supabase, target, subject, body);
  if (!id) redirect(`${back}?error=send-failed`);

  // The doorbell, after the message is safely written. A push is an HTTPS round
  // trip to a third party and lib/push.ts swallows every failure by design —
  // the member has the message either way, so this must never be able to turn a
  // successful send into an error.
  //
  // Only when the account is in a clan this caller leads: push_targets() (023)
  // is clan-scoped and returns nothing otherwise, so a platform admin writing
  // to a clanless applicant simply leaves the message in the inbox, which is
  // the right outcome rather than a missing one.
  const account = await adminAccount(supabase, target);
  const clanId = account?.memberships[0]?.clanId;
  if (clanId) {
    await notifyUsers(supabase, clanId, "direct_messages", [target], {
      title: "A message from your clan leadership",
      // The subject, never the body. A push payload is decrypted on a device
      // this system does not control and may sit on a lock screen.
      body: subject,
      url: "/notifications",
      tag: `message-${id}`,
    });
  }

  revalidatePath(back);
  revalidatePath("/notifications");
  redirect(`${back}?ok=message-sent`);
}

async function removeAccess(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const target = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const back = `/admin/members/${target}`;

  if (!target) redirect("/admin/members?error=bad-request");

  // Required by this page, not by the database. 039 accepts a null reason
  // because a future caller might legitimately have none; a person clicking
  // this button always does, and an audit entry reading "removed, no reason
  // given" is the one nobody can act on six months later.
  if (!reason) redirect(`${back}?error=no-reason`);

  if (!(await removeAccount(supabase, target, reason))) {
    redirect(`${back}?error=remove-refused`);
  }

  revalidatePath(back);
  revalidatePath("/admin/members");
  redirect(`${back}?ok=account-removed`);
}

async function restoreAccess(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const target = String(formData.get("userId") ?? "");
  const back = `/admin/members/${target}`;

  if (!target) redirect("/admin/members?error=bad-request");

  if (!(await restoreAccount(supabase, target))) {
    redirect(`${back}?error=restore-refused`);
  }

  revalidatePath(back);
  revalidatePath("/admin/members");
  redirect(`${back}?ok=account-restored`);
}

function statusLine(account: AdminAccount): string {
  if (account.removedAt) return "Access removed";
  if (account.status === "pending") {
    return account.requestedClan
      ? `Waiting for approval — verified in ${account.requestedClan}`
      : "Waiting — has not linked a village yet";
  }
  if (account.status === "rejected") return "Declined";
  return "Active";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function AdminAccountPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId: target } = await params;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  // 404 covers both "no such account" and "not one you may administer", and
  // deliberately does not distinguish them. Telling a prober which of the two it
  // was is telling them that the account exists.
  const account = await adminAccount(supabase, target);
  if (!account) notFound();

  // 040's "read own notifications" gives the sender their own side of the
  // conversation, so a leader can see what has already been said before saying
  // it again. It is not the whole history: a message from a DIFFERENT leader is
  // theirs, not this caller's, and stays private.
  const sent = await sentTo(supabase, userId, target);

  const isSelf = account.id === userId;
  const removable = !isSelf && !account.isPlatformAdmin && !account.removedAt;

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 sm:p-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/members">
          <ArrowLeft aria-hidden />
          All accounts
        </Link>
      </Button>

      <PageHeader
        title={account.username ?? account.displayName ?? account.email}
        description={statusLine(account)}
      />

      {account.removedAt && (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>This account has been removed</AlertTitle>
          <AlertDescription>
            They cannot see any clan data and their clan roles are revoked. Nothing
            was deleted — their villages are still linked to this account, and the
            reason is on the audit log. Restoring puts them back in the approval
            queue.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Who they are ─────────────────────────────────────────────────── */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <h2 className="text-lg font-semibold">Account</h2>

        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <span className="break-all">{account.email}</span>
          </Field>
          <Field label="Username">{account.username ?? "Not set yet"}</Field>
          <Field label="Status">
            <span className="flex flex-wrap items-center gap-2">
              {statusLine(account)}
              {account.isPlatformAdmin && <Badge variant="secondary">Platform owner</Badge>}
              {isSelf && <Badge variant="outline">This is you</Badge>}
            </span>
          </Field>
          <Field label="Signed up">
            <LocalTime iso={account.createdAt} />
          </Field>
          {account.approvedAt && (
            <Field label="Approved">
              <LocalTime iso={account.approvedAt} />
            </Field>
          )}
          {account.removedAt && (
            <Field label="Removed">
              <LocalTime iso={account.removedAt} />
            </Field>
          )}
        </dl>

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Clans</h3>
          {account.memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No clan roles. {account.removedAt
                ? "They were revoked when this account was removed."
                : "Approving this account grants membership of the clan they verified in."}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {account.memberships.map((m) => (
                <li key={m.clanId}>
                  <Badge variant="outline">
                    {m.clan} — {m.role}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Villages</h3>
          {account.players.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No village linked. Until they verify one in game, no leader can tell
              who this account belongs to.
            </p>
          ) : (
            <ul className="space-y-1">
              {account.players.map((p) => (
                <li key={p.tag} className="flex items-center gap-2 text-sm">
                  <Castle aria-hidden className="text-muted-foreground size-4" />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">{p.tag}</span>
                  {p.thLevel !== null && (
                    <span className="text-muted-foreground text-xs">TH{p.thLevel}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Say something ────────────────────────────────────────────────── */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Send a message</h2>
          <p className="text-muted-foreground text-sm">
            It appears under the bell on their Notifications page and stays there.
            If they have push switched on they also get a nudge on their phone — but
            the message does not depend on that, and muting notices cannot suppress
            it.
          </p>
        </div>

        {isSelf ? (
          <p className="text-muted-foreground text-sm">
            This is your own account, so there is nobody to write to.
          </p>
        ) : (
          <form action={sendMessage} className="space-y-3">
            <input type="hidden" name="userId" value={account.id} />
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                name="subject"
                required
                maxLength={120}
                placeholder="Missed war attacks"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Message</Label>
              <textarea
                id="body"
                name="body"
                required
                rows={4}
                maxLength={BODY_LIMIT}
                placeholder="Say what happened and what you would like them to do."
                className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
              />
            </div>
            <SubmitButton pendingLabel="Sending">
              <Mail aria-hidden />
              Send message
            </SubmitButton>
          </form>
        )}

        {sent.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-medium">What you have already sent</h3>
            <ul className="divide-y rounded-md border">
              {sent.map((message) => (
                <li key={message.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{message.title}</span>
                    <Badge variant={message.readAt ? "success" : "outline"}>
                      {message.readAt ? "Read" : "Unread"}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      <LocalTime iso={message.createdAt} />
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                    {message.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Take access away ─────────────────────────────────────────────── */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            {account.removedAt ? "Restore this account" : "Remove access"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {account.removedAt
              ? "This puts the account back in the approval queue. It does not let them straight back in — a leader still has to approve it, exactly as with a new account."
              : "They stop being able to see anything and their clan roles are revoked. Nothing is deleted: the account, its villages and its history all stay, and you can restore it here afterwards."}
          </p>
        </div>

        {account.removedAt ? (
          <form action={restoreAccess}>
            <input type="hidden" name="userId" value={account.id} />
            <SubmitButton variant="outline" pendingLabel="Restoring">
              <Undo2 aria-hidden />
              Restore account
            </SubmitButton>
          </form>
        ) : !removable ? (
          <p className="text-muted-foreground text-sm">
            {isSelf
              ? "You cannot remove your own account — that would lock you out of this page."
              : "The platform owner's account can never be removed."}
          </p>
        ) : (
          <form action={removeAccess} className="space-y-3">
            <input type="hidden" name="userId" value={account.id} />
            <div className="space-y-1.5">
              <Label htmlFor="reason">Why are you removing this account?</Label>
              <Input
                id="reason"
                name="reason"
                required
                maxLength={200}
                placeholder="Kept skipping war attacks after two warnings"
              />
              <p className="text-muted-foreground text-xs">
                This goes on the audit log, where every leader of the clan can read
                it. It is the only explanation anyone will have later.
              </p>
            </div>
            <SubmitButton variant="destructive" pendingLabel="Removing">
              <ShieldAlert aria-hidden />
              Remove access
            </SubmitButton>
          </form>
        )}
      </section>
    </main>
  );
}

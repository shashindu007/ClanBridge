// T5.1 / T5.2 — announcements. Leadership posts, everyone reads.
//
// This is the page that replaces the WhatsApp message that gets buried.
//
// T5.2 — SAFE RENDERING. The body is rendered as TEXT, by React, as a string
// child. No dangerouslySetInnerHTML, no markdown parser, no sanitiser to keep
// up to date. React escapes string children, so a body containing <script> is
// displayed rather than executed, and that property holds without anything
// having to be configured correctly.
//
// `whitespace-pre-line` gives paragraphs from the newlines a leader actually
// typed. That is the whole formatting feature, on purpose: the alternative is a
// markdown dependency whose escape hatches are the thing this rule exists to
// avoid. If richer formatting is ever wanted, it needs its own task and a
// deliberate look at what the parser permits.
//
// Writes go through the definer functions in migration 021 (post/edit/remove),
// never through a direct insert — see the header of lib/audit.ts for why.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireClanByTag } from "@/lib/clans";
import { notifyClan } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { announcementsForClan } from "@/repositories/clans";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

/** Leader and co-leader, matching auth_leadership_clan_ids() in migration 021. */
function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_ZONE,
  });
}

export default async function NoticesPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { clanTag } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const notices = await announcementsForClan(supabase, clan.id);
  const mayPost = isLeadership(clan.role);
  const base = `/${encodeURIComponent(clan.tag)}/notices`;

  // The server actions below decide what to RENDER and nothing more. Every one
  // of them calls a function that re-checks authority in the database, so a
  // member who reaches the action directly is refused there (R3, 021).
  async function createNotice(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const clan = await requireClanByTag(supabase, clanTag);

    const title = String(formData.get("title") ?? "");

    const { error } = await supabase.rpc("post_announcement", {
      p_clan: clan.id,
      p_title: title,
      p_body: String(formData.get("body") ?? ""),
      p_pinned: formData.get("pinned") === "on",
    });

    if (error) {
      redirect(`${base}?error=${encodeURIComponent(error.message)}`);
    }

    // T5.6 — the notice is posted; now tell people it exists.
    //
    // AFTER the write and never before it: the announcement is the thing that
    // matters and it is already durable at this point. Sending first would risk
    // notifying the clan about a post that then failed to save.
    //
    // Awaited rather than fired and forgotten. A Server Action's process may be
    // frozen the moment it returns, so a dangling promise here is a notification
    // that sometimes sends and sometimes does not, depending on how quickly the
    // response is flushed — the worst of both.
    //
    // The BODY IS NOT IN THE PAYLOAD. A push notification is decrypted on a
    // device this system does not control and lands on a lock screen; it names
    // what happened and links to where to read it.
    await notifyClan(supabase, clan.id, "announcements", {
      title: `${clan.name} — new notice`,
      body: title,
      url: base,
      // One collapse key per clan: two notices posted in a row leave one
      // notification, and it is the newer one.
      tag: `notice:${clan.id}`,
    });

    revalidatePath(base);
    revalidatePath(`/${encodeURIComponent(clan.tag)}`); // the dashboard shows the latest
    redirect(`${base}?ok=notice-posted`);
  }

  async function removeNotice(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const clan = await requireClanByTag(supabase, clanTag);

    const { error } = await supabase.rpc("remove_announcement", {
      p_id: String(formData.get("id") ?? ""),
    });

    if (error) {
      redirect(`${base}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(base);
    revalidatePath(`/${encodeURIComponent(clan.tag)}`);
    redirect(`${base}?ok=notice-removed`);
  }

  async function togglePin(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const clan = await requireClanByTag(supabase, clanTag);

    const { error } = await supabase.rpc("edit_announcement", {
      p_id: String(formData.get("id") ?? ""),
      p_title: String(formData.get("title") ?? ""),
      p_body: String(formData.get("body") ?? ""),
      p_pinned: formData.get("pinned") === "1",
    });

    if (error) {
      redirect(`${base}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(base);
    revalidatePath(`/${encodeURIComponent(clan.tag)}`);
    redirect(`${base}?ok=notice-pinned`);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
        <p className="text-muted-foreground text-sm">
          {clan.name} —{" "}
          {mayPost
            ? "you can post here; everyone in the clan can read."
            : "posted by your leader and co-leaders."}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {mayPost && (
        <form action={createNotice} className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Post an announcement</h2>

          <div className="space-y-1">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" maxLength={200} required />
          </div>

          <div className="space-y-1">
            <Label htmlFor="body">Message</Label>
            <textarea
              id="body"
              name="body"
              required
              maxLength={5000}
              rows={4}
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
            />
            <p className="text-muted-foreground text-xs">
              Plain text. Line breaks are kept; nothing else is formatted, and no
              HTML is ever rendered (T5.2).
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pinned" className="h-4 w-4" />
            Pin to the top
          </label>

          <SubmitButton>Post</SubmitButton>
        </form>
      )}

      {notices.length === 0 ? (
        <section className="cb-panel space-y-2 rounded-lg border p-6">
          <h2 className="font-medium">Nothing posted yet</h2>
          <p className="text-muted-foreground text-sm">
            {mayPost
              ? "Post the first one above. It appears on the clan dashboard too."
              : "Your leadership has not posted anything here yet."}
          </p>
        </section>
      ) : (
        <ul className="space-y-4">
          {notices.map((notice) => (
            <li key={notice.id} className="cb-panel space-y-2 rounded-lg border p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">{notice.title}</h2>
                {notice.pinned && <Badge variant="secondary">pinned</Badge>}
              </div>

              {/* T5.2 — a string child. React escapes it; nothing is parsed. */}
              <p className="text-sm whitespace-pre-line">{notice.body}</p>

              <div className="flex flex-wrap items-center gap-3">
                <p className="text-muted-foreground text-xs">{when(notice.createdAt)}</p>

                {mayPost && (
                  <>
                    <form action={togglePin}>
                      <input type="hidden" name="id" value={notice.id} />
                      <input type="hidden" name="title" value={notice.title} />
                      <input type="hidden" name="body" value={notice.body} />
                      <input
                        type="hidden"
                        name="pinned"
                        value={notice.pinned ? "0" : "1"}
                      />
                      <SubmitButton variant="outline" size="sm">
                        {notice.pinned ? "Unpin" : "Pin"}
                      </SubmitButton>
                    </form>

                    <form action={removeNotice}>
                      <input type="hidden" name="id" value={notice.id} />
                      <SubmitButton variant="outline" size="sm">
                        Remove
                      </SubmitButton>
                    </form>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {mayPost && (
        <p className="text-muted-foreground text-xs">
          Removing hides an announcement; it is never deleted (R4), and who
          removed it is recorded in the audit log.
        </p>
      )}
    </main>
  );
}

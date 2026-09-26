// T5.5 + T5.9 — notification settings.
//
// Two separate things on one page, and the distinction matters:
//
//   DEVICE   whether this browser has a push subscription at all (T5.5). Per
//            device, held by the browser, and the member may have three.
//   KINDS    which notifications this member wants, on every device (T5.9).
//            One row in notification_preferences, or none at all.
//
// A member who cannot work out why they get nothing is usually looking at a
// device that was never subscribed while their kinds are all enabled, so the
// page says which is which rather than presenting one merged switch.
//
// Not under [clanTag]: preferences are per member, not per clan. A member of
// three clans has one set of these.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { isUniqueViolation, safeMessage } from "@/lib/errors";
import { PushToggle } from "@/components/push-toggle";
import { SubmitButton } from "@/components/submit-button";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

const PATH = "/settings/notifications";

/**
 * The switchable kinds, in the order they are shown.
 *
 * `column` matches notification_preferences in migration 023 and the
 * NotificationKind union in lib/push.ts. All three have to agree; there is no
 * type that spans SQL and TypeScript, so they are listed here once and the page
 * is built from the list rather than from three hand-written checkboxes.
 */
const KINDS = [
  {
    column: "announcements",
    label: "Announcements",
    hint: "A leader posts a notice.",
  },
  {
    column: "cwl_reminders",
    label: "CWL reminders",
    hint: "A war day is ending and you still have an attack.",
  },
  {
    column: "war_reminders",
    label: "War reminders",
    hint: "A clan war is ending and you still have an attack.",
  },
  {
    column: "raid_reminders",
    label: "Raid weekend reminders",
    hint: "Raid weekend is closing and you have attacks left.",
  },
  {
    column: "poll_reminders",
    label: "Poll reminders",
    hint: "A poll closes soon and you have not answered.",
  },
  {
    // T12.2. Its own kind rather than riding on Announcements, so switching
    // clan notices off cannot quietly suppress the one notification that is
    // addressed to you personally. Turning it off only stops the nudge — the
    // message itself still arrives on your Messages page.
    column: "direct_messages",
    label: "Messages from leadership",
    hint: "A leader writes to you directly. The message is kept either way.",
  },
] as const;

type PrefRow = Record<string, boolean> & { id?: string };

export default async function NotificationSettingsPage() {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const { data } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  const prefs = (data ?? null) as PrefRow | null;

  // Absent row means everything is enabled — the same rule push_targets() applies
  // with coalesce(..., true). If these two ever disagree, the page shows one
  // thing and the send path does another, which is the hardest kind of bug to
  // be told about.
  const enabled = (column: string): boolean => prefs?.[column] !== false;

  async function save(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (!userId) redirect("/login");

    // An unchecked checkbox sends nothing at all, so every column has to be
    // written explicitly from the known list. Reading only what arrived would
    // make "turn everything off" indistinguishable from "submitted nothing".
    const row: Record<string, unknown> = { user_id: userId };
    for (const kind of KINDS) {
      row[kind.column] = formData.get(kind.column) === "on";
    }

    // Update the live row, or insert the first one — NOT an upsert.
    //
    // This was `upsert(row, { onConflict: "user_id" })`, and it failed on every
    // save: 023's unique index on user_id is PARTIAL (`where deleted_at is
    // null`, so R4's soft-deleted rows do not block a fresh one), and Postgres
    // will not match ON CONFLICT (user_id) to a partial index unless the
    // statement repeats its predicate — which PostgREST cannot express. 033
    // hit the same wall and says so.
    const { data: live, error: readError } = await supabase
      .from("notification_preferences")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();

    let error = readError;
    if (!error && live) {
      ({ error } = await supabase
        .from("notification_preferences")
        .update(row)
        .eq("id", (live as { id: string }).id)
        .eq("user_id", userId));
    } else if (!error) {
      ({ error } = await supabase.from("notification_preferences").insert(row));
      // Two tabs saving a first row at once: the loser hits the partial unique
      // index. The winner's row is there now, so update it instead.
      if (error && isUniqueViolation(error)) {
        ({ error } = await supabase
          .from("notification_preferences")
          .update(row)
          .eq("user_id", userId)
          .is("deleted_at", null));
      }
    }

    if (error) {
      safeMessage("notification preferences", error, "");
      redirect(`${PATH}?error=notifications-failed`);
    }

    revalidatePath(PATH);
    // Was `?saved=1`, which nothing on this page ever rendered — the
    // member pressed Save and got no acknowledgement at all. Now a toast.
    redirect(`${PATH}?ok=notifications-saved`);
  }

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      {/* "Notification settings", not "Notifications": the feed has that name,
          and two pages with one title is two pages nobody can tell apart. */}
      <PageHeader
        back={{ href: "/notifications", label: "Notifications" }}
        title="Notification settings"
        description="What reaches this phone as a push. Everything is kept in your Notifications feed either way."
      />

      <section className="cb-panel space-y-4 rounded-panel border p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">This device</h2>
          <p className="text-muted-foreground text-sm">
            Turn notifications on for the browser or phone you are using now.
          </p>
        </div>

        <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      </section>

      <section className="cb-panel space-y-4 rounded-panel border p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">What to send</h2>
          <p className="text-muted-foreground text-sm">
            Applies to every device you have turned on. Everything is on until
            you change it.
          </p>
        </div>

        <form action={save} className="space-y-4">
          {KINDS.map((kind) => (
            <div key={kind.column} className="flex items-start gap-3">
              <input
                id={kind.column}
                name={kind.column}
                type="checkbox"
                defaultChecked={enabled(kind.column)}
                className="mt-1 size-4"
              />
              <div className="space-y-0.5">
                <Label htmlFor={kind.column} className="font-normal">
                  {kind.label}
                </Label>
                <p className="text-muted-foreground text-xs">{kind.hint}</p>
              </div>
            </div>
          ))}

          <SubmitButton>Save</SubmitButton>
        </form>
      </section>
    </main>
  );
}

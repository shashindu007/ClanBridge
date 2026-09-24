// T12.5 — where a member tells us what they think.
//
// The only source of the quotes on the public landing page. Nothing a member
// writes here is public until the platform admin approves it (042's
// review_feedback), and the form says so before they press anything — a quote
// appearing on the internet with your name on it should never be a surprise.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MessageSquareHeart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { myFeedback, submitFeedback, type FeedbackStatus } from "@/repositories/feedback";
import { LocalTime } from "@/components/local-time";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

/** 042's check constraint, restated so the form can say so first. */
const BODY_MIN = 10;
const BODY_MAX = 500;

async function send(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const rating = Number(formData.get("rating"));
  const body = String(formData.get("body") ?? "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    redirect("/feedback?error=feedback-no-rating");
  }
  if (body.length < BODY_MIN) redirect("/feedback?error=feedback-too-short");
  if (body.length > BODY_MAX) redirect("/feedback?error=feedback-too-long");

  if (!(await submitFeedback(supabase, rating, body))) {
    redirect("/feedback?error=feedback-refused");
  }

  revalidatePath("/feedback");
  redirect("/feedback?ok=feedback-sent");
}

const STATUS: Record<FeedbackStatus, { label: string; variant: "info" | "success" | "secondary" }> = {
  pending: { label: "Waiting for review", variant: "info" },
  approved: { label: "On the home page", variant: "success" },
  hidden: { label: "Kept private", variant: "secondary" },
};

export default async function FeedbackPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const mine = await myFeedback(supabase, userId);
  const pending = mine.find((f) => f.status === "pending");

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Feedback"
        description="Tell us what works and what does not. Every message is read."
      />

      <section className="cb-panel space-y-5 rounded-panel border p-5">
        <form action={send} className="space-y-5">
          {/* A real fieldset, so a screen reader announces the five options as
              one question rather than five unrelated buttons. */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">How would you rate ClanBridge?</legend>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  className="has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-ring/50 flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-[3px]"
                >
                  <input
                    type="radio"
                    name="rating"
                    value={n}
                    required
                    defaultChecked={pending?.rating === n}
                    className="sr-only"
                  />
                  <span aria-hidden>{"★".repeat(n)}</span>
                  <span className="sr-only">{n} out of 5</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="body">What would you tell another member?</Label>
            <textarea
              id="body"
              name="body"
              required
              minLength={BODY_MIN}
              maxLength={BODY_MAX}
              rows={5}
              defaultValue={pending?.body ?? ""}
              aria-describedby="body-hint"
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-control border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              placeholder="The war board means nobody asks who is left to attack any more."
            />
            <p id="body-hint" className="text-muted-foreground text-xs">
              {BODY_MIN}–{BODY_MAX} characters. The platform owner may show it on
              the public home page with your <strong>username and clan</strong> —
              never your email. Nothing is public until they approve it.
            </p>
          </div>

          <SubmitButton pendingLabel="Sending">
            <MessageSquareHeart aria-hidden />
            {pending ? "Update my feedback" : "Send feedback"}
          </SubmitButton>
          {pending && (
            <p className="text-muted-foreground text-xs">
              You already have feedback waiting for review — sending again replaces it.
            </p>
          )}
        </form>
      </section>

      {mine.length > 0 && (
        <section aria-labelledby="mine-title" className="space-y-3">
          <h2 id="mine-title" className="text-lg font-semibold">What you have sent</h2>
          <ul className="cb-panel divide-y rounded-panel border">
            {mine.map((item) => (
              <li key={item.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-label={`${item.rating} out of 5`}>{"★".repeat(item.rating)}</span>
                  <Badge variant={STATUS[item.status].variant}>{STATUS[item.status].label}</Badge>
                  <span className="text-muted-foreground ml-auto text-xs">
                    <LocalTime iso={item.createdAt} />
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// T12.5 — the platform admin decides which feedback the public sees.
//
// Platform admin only. The landing page speaks for every clan on the platform,
// and one clan's leader choosing what represents all of them is the wrong
// authority — 042's review_feedback() refuses anybody else, and this page is
// only the rendering of that rule, never the enforcement of it.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId, isPlatformAdmin } from "@/lib/auth";
import { allFeedback, reviewFeedback, type FeedbackStatus } from "@/repositories/feedback";
import { LocalTime } from "@/components/local-time";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

async function decide(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!id || (status !== "approved" && status !== "hidden")) {
    redirect("/admin/feedback?error=bad-request");
  }

  if (!(await reviewFeedback(supabase, id, status))) {
    redirect("/admin/feedback?error=forbidden");
  }

  // The `done` variable is this codebase's convention for a handler with more
  // than one outcome — lib/feedback.test.ts reads its assignments to check that
  // every code it can hold has a sentence.
  let done = "feedback-hidden";
  if (status === "approved") done = "feedback-approved";

  revalidatePath("/admin/feedback");
  revalidatePath("/");
  redirect(`/admin/feedback?ok=${done}`);
}

const LABEL: Record<FeedbackStatus, { text: string; variant: "info" | "success" | "secondary" }> = {
  pending: { text: "Waiting", variant: "info" },
  approved: { text: "On the home page", variant: "success" },
  hidden: { text: "Hidden", variant: "secondary" },
};

export default async function AdminFeedbackPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  if (!(await isPlatformAdmin(supabase, userId))) {
    return (
      <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
        <PageHeader title="Feedback" />
        <Alert variant="info">
          <AlertTitle>This page is for the platform owner</AlertTitle>
          <AlertDescription>
            Only the platform owner decides which feedback appears on the public home page.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const items = await allFeedback(supabase);

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Feedback"
        description="Approve what may appear on the public home page. Approved quotes show the member's username and clan — never their email."
      />

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-panel border border-dashed p-6 text-center text-sm">
          No feedback yet. Members send it from the Feedback page.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-label={`${item.rating} out of 5`}>{"★".repeat(item.rating)}</span>
                <Badge variant={LABEL[item.status].variant}>{LABEL[item.status].text}</Badge>
                <span className="text-muted-foreground ml-auto text-xs">
                  <LocalTime iso={item.createdAt} />
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{item.body}</p>
              <div className="flex flex-wrap gap-2">
                {item.status !== "approved" && (
                  <form action={decide}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="status" value="approved" />
                    <SubmitButton size="sm" pendingLabel="Approving">
                      <Eye aria-hidden />
                      Show on home page
                    </SubmitButton>
                  </form>
                )}
                {item.status !== "hidden" && (
                  <form action={decide}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="status" value="hidden" />
                    <SubmitButton size="sm" variant="outline" pendingLabel="Hiding">
                      <EyeOff aria-hidden />
                      Keep private
                    </SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

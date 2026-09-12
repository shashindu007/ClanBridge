// T4B.2 — Create a poll. Leader and co-leader only.
//
// The CWL availability template pre-fills In / Out / Maybe and sets scope to
// 'family', because a CWL poll is asked of everyone at once — the leader is
// picking across all clans (T4B.7), and three separate clan polls would produce
// three lists to merge by hand.
//
// "Maybe" earns its place. Forcing a binary answer from someone who does not yet
// know pushes them to guess, and a wrong In is worse for the leader than an
// honest Maybe: it fills a roster slot that then goes unused.
//
// Authority is enforced by the policies in migration 010, not by hiding this
// page. The role check below only produces a better error than a rejected insert.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireClanByTag } from "@/lib/clans";
import { currentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createPoll, type PollScope, type PollType } from "@/repositories/polls";
import { POLL_TEMPLATES } from "@/services/polls";

export const dynamic = "force-dynamic";

const POLL_TYPES: PollType[] = ["cwl_availability", "war_availability", "general"];

async function submit(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const clan = await requireClanByTag(supabase, clanTag);
  const back = `/${encodeURIComponent(clan.tag)}/polls`;

  const pollType = String(formData.get("pollType") ?? "general") as PollType;
  if (!POLL_TYPES.includes(pollType)) redirect(`${back}/new?error=bad-type`);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect(`${back}/new?error=no-title`);

  const question = String(formData.get("question") ?? "").trim() || null;
  const season = String(formData.get("season") ?? "").trim() || null;

  // A CWL poll spans every clan; anything else belongs to this one.
  const scope: PollScope = pollType === "cwl_availability" ? "family" : "clan";

  const closesRaw = String(formData.get("closesAt") ?? "").trim();
  // datetime-local has no timezone, so the browser's wall-clock reading is
  // interpreted as UTC here. Good enough for a closing date measured in days;
  // T9.9 is where timestamps get handled properly across the app.
  const closesAt = closesRaw ? new Date(closesRaw).toISOString() : null;

  const options = String(formData.get("options") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // A poll nobody can answer is worse than no poll: it looks like a question was
  // asked and silently collects nothing.
  if (options.length < 2) redirect(`${back}/new?error=need-options`);
  if (new Set(options).size !== options.length) redirect(`${back}/new?error=duplicate-options`);

  const result = await createPoll(
    supabase,
    {
      scope,
      clanId: scope === "clan" ? clan.id : null,
      season,
      pollType,
      title,
      question,
      closesAt,
      createdBy: userId,
    },
    options,
  );

  if ("error" in result) {
    redirect(`${back}/new?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(back);
  redirect(`${back}/${result.id}`);
}

export default async function CreatePollPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ error?: string; type?: string }>;
}) {
  const { clanTag } = await params;
  const { error, type } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const back = `/${encodeURIComponent(clan.tag)}/polls`;

  if (clan.role !== "leader" && clan.role !== "co-leader") {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Create a poll</h1>
        <Alert>
          <AlertTitle>Leadership only</AlertTitle>
          <AlertDescription>
            Only a leader or co-leader of {clan.name} can open a poll.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href={back}>Back to polls</Link>
        </Button>
      </main>
    );
  }

  const selectedType = (type as PollType) ?? "cwl_availability";
  const template = POLL_TEMPLATES[selectedType] ?? POLL_TEMPLATES.general!;
  const thisMonth = new Date().toISOString().slice(0, 7);

  const message: Record<string, string> = {
    "no-title": "Give the poll a title so members know what they are answering.",
    "need-options": "A poll needs at least two options.",
    "duplicate-options": "Two options have the same label, which makes the result unreadable.",
    "bad-type": "That poll type is not one this system knows.",
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create a poll</h1>
        <p className="text-muted-foreground text-sm">
          {clan.name} — a CWL poll is asked of every clan at once.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{message[error] ?? error}</AlertDescription>
        </Alert>
      )}

      {/* Changing the type reloads with a different template rather than doing it
          in the browser, so this page stays a Server Component. */}
      <nav className="flex flex-wrap gap-2">
        {POLL_TYPES.map((t) => (
          <Button
            key={t}
            asChild
            size="sm"
            variant={t === selectedType ? "default" : "outline"}
          >
            <Link href={`${back}/new?type=${t}`}>
              {t === "cwl_availability"
                ? "CWL availability"
                : t === "war_availability"
                  ? "War availability"
                  : "General"}
            </Link>
          </Button>
        ))}
      </nav>

      <form action={submit} className="space-y-5 rounded-lg border p-6">
        <input type="hidden" name="clanTag" value={clanTag} />
        <input type="hidden" name="pollType" value={selectedType} />

        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            required
            maxLength={120}
            defaultValue={
              selectedType === "cwl_availability"
                ? `CWL availability — ${thisMonth}`
                : template.title
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="question">Question (optional)</Label>
          <Input
            id="question"
            name="question"
            maxLength={300}
            placeholder="Are you available for CWL this season?"
          />
        </div>

        {selectedType === "cwl_availability" && (
          <div className="space-y-2">
            <Label htmlFor="season">Season</Label>
            <Input id="season" name="season" defaultValue={thisMonth} pattern="\d{4}-\d{2}" />
            <p className="text-muted-foreground text-xs">
              Links the answers to a CWL season, so the roster builder can find them.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="closesAt">Closes at (optional)</Label>
          <Input id="closesAt" name="closesAt" type="datetime-local" />
          <p className="text-muted-foreground text-xs">
            After this, answers lock. Leave empty to keep it open until you close it.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="options">Options, one per line</Label>
          <textarea
            id="options"
            name="options"
            rows={4}
            required
            defaultValue={template.options.join("\n")}
            className="border-input placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:ring-1 focus-visible:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <SubmitButton>Open the poll</SubmitButton>
          <Button asChild variant="outline">
            <Link href={back}>Cancel</Link>
          </Button>
        </div>
      </form>
    </main>
  );
}

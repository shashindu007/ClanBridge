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
// REDESIGNED as two steps: pick what you are asking (three cards that say what
// each poll is for and where its answers show up), then fill in the details —
// with the CWL season chosen from a list instead of typed as "2026-09", and a
// warning not to rename In / Maybe / Out, which the lineup pages sort by.
//
// Authority is enforced by the policies in migration 010, not by hiding this
// page. The role check below only produces a better error than a rejected insert.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CircleAlert, MessageSquare, Shield, Swords } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { requireClanByTag } from "@/lib/clans";
import { canOpenPolls } from "@/lib/visibility";
import { seasonLabel, startableSeasons } from "@/lib/roster-view";
import { currentUserId } from "@/lib/auth";
import { parseDisplayLocal } from "@/lib/display-time";
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
  // The page offers this month and next from a list; anything else is a crafted
  // request or a stale tab from last month.
  if (pollType === "cwl_availability" && (!season || !startableSeasons(new Date()).includes(season))) {
    redirect(`${back}/new?type=cwl_availability&error=bad-season`);
  }

  // A CWL poll spans every clan; anything else belongs to this one.
  const scope: PollScope = pollType === "cwl_availability" ? "family" : "clan";

  // datetime-local has no timezone. Read it as clan-local time — the zone the
  // page states and every server-rendered time is shown in — never as UTC,
  // which put the close 5h30 late for every leader in Colombo.
  const closesRaw = String(formData.get("closesAt") ?? "").trim();
  const closesAt = parseDisplayLocal(closesRaw)?.toISOString() ?? null;
  if (closesRaw && !closesAt) redirect(`${back}/new?error=bad-close-time`);

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
  redirect(`${back}/${result.id}?ok=poll-opened`);
}

/** What each kind of poll is FOR, in the words a leader would use. */
const TYPE_INFO: Record<PollType, { label: string; description: string; icon: React.ReactNode }> = {
  cwl_availability: {
    label: "CWL availability",
    description: "Asks every clan who can play Clan War League this month. Answers appear in the CWL roster builder.",
    icon: <Swords aria-hidden className="size-5" />,
  },
  war_availability: {
    label: "War availability",
    description: "Asks this clan who can play the next war. Answers appear on the war lineup, with the war size they support.",
    icon: <Shield aria-hidden className="size-5" />,
  },
  general: {
    label: "Anything else",
    description: "A question of your own for this clan, with the answers you choose.",
    icon: <MessageSquare aria-hidden className="size-5" />,
  },
};

export default async function CreatePollPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { clanTag } = await params;
  const { type } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const back = `/${encodeURIComponent(clan.tag)}/polls`;

  if (!canOpenPolls(clan.role)) {
    return (
      <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
        <PageHeader back={{ href: back, label: "All polls" }} title="Create a poll" />
        <Alert variant="info">
          <CircleAlert aria-hidden />
          <AlertTitle>Only leaders can open polls</AlertTitle>
          <AlertDescription>
            Ask a leader or co-leader of {clan.name} if there is something the clan should be asked.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const selectedType: PollType = POLL_TYPES.includes(type as PollType) ? (type as PollType) : "cwl_availability";
  const template = POLL_TEMPLATES[selectedType] ?? POLL_TEMPLATES.general!;
  const seasons = startableSeasons(new Date());
  const availability = selectedType !== "general";

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <PageHeader
        back={{ href: back, label: "All polls" }}
        eyebrow={clan.name}
        title="Create a poll"
        description="Ask the clan a question. Members answer on their phones, and you can see who has not answered yet."
      />

      {/* Step 1. Changing the type reloads with a different template rather than
          doing it in the browser, so this page stays a Server Component. */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. What do you want to ask?</h2>
        <nav aria-label="Kind of poll" className="grid gap-3 sm:grid-cols-3">
          {POLL_TYPES.map((t) => {
            const info = TYPE_INFO[t];
            const active = t === selectedType;
            return (
              <Link
                key={t}
                href={`${back}/new?type=${t}`}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col gap-2 rounded-panel border-2 p-4 transition-colors ${
                  active ? "border-primary bg-accent" : "bg-card hover:bg-accent/50"
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  {info.icon}
                  {info.label}
                </span>
                <span className="text-muted-foreground text-xs">{info.description}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      <form action={submit} className="cb-panel space-y-5 rounded-panel border p-5">
        <h2 className="text-lg font-semibold">2. The details</h2>
        <input type="hidden" name="clanTag" value={clanTag} />
        <input type="hidden" name="pollType" value={selectedType} />

        {selectedType === "cwl_availability" && (
          <div className="space-y-1.5">
            <Label htmlFor="season">Which CWL season?</Label>
            <select
              id="season"
              name="season"
              defaultValue={seasons[0]}
              className="border-input bg-background h-10 w-full rounded-control border px-3 text-sm sm:w-72"
            >
              {seasons.map((s, i) => (
                <option key={s} value={s}>
                  {seasonLabel(s)} {i === 0 ? "(this month)" : "(next month)"}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              Links the answers to that season, so the roster builder shows them.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            required
            maxLength={120}
            defaultValue={
              selectedType === "cwl_availability"
                ? `CWL availability — ${seasonLabel(seasons[0]!)}`
                : template.title
            }
            placeholder="e.g. Clan capital weekend plan"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="question">Question (optional)</Label>
          <Input
            id="question"
            name="question"
            maxLength={300}
            placeholder={
              selectedType === "war_availability"
                ? "Can you play both attacks in the next war?"
                : "Are you available for CWL this season?"
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="options">Answers members can choose</Label>
          <textarea
            id="options"
            name="options"
            rows={4}
            required
            defaultValue={template.options.join("\n")}
            className="border-input placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-control border bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:ring-1 focus-visible:outline-none"
          />
          <p className="text-muted-foreground text-xs">
            One answer per line, at least two.
            {availability &&
              " Keep In, Maybe and Out as they are — the lineup pages sort players by those exact words."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="closesAt">Close automatically at, Sri Lanka time (optional)</Label>
          <Input id="closesAt" name="closesAt" type="datetime-local" className="sm:w-72" />
          <p className="text-muted-foreground text-xs">
            Answers lock at this time. Leave it empty to keep the poll open until you close it yourself.
          </p>
        </div>

        {/* No Cancel beside it: "All polls" at the top of the page is the same
            link, and two ways out of one form is one too many. */}
        <div className="flex flex-wrap gap-3 border-t pt-5">
          <SubmitButton variant="gold" pendingLabel="Opening">
            Open the poll
          </SubmitButton>
        </div>
      </form>
    </main>
  );
}

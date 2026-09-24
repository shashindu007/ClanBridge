// T8.4/T8.5 — browse the layout library, filter it, and vote.
//
// R1 — PostgreSQL only. R3 — the clan is resolved by tag through
// requireClanByTag, so every layout below is known to belong here before any of
// them is read.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE IMAGES ARE BEHIND SIGNED URLs, AND THAT IS THE WHOLE REASON THE BUCKET IS
// PRIVATE
//
// base_layouts.image_url stores a PATH inside the bucket, not a URL. A public
// bucket would serve every screenshot to anyone who ever saw a link, and a war
// base is precisely the thing an opponent would like to see. Signing happens
// here, per request, for a member who has already passed the clan check — and
// the links expire, so one pasted into a chat stops working rather than
// becoming a permanent hole.
//
// Signed in ONE batch rather than per card: createSignedUrls takes a list, and
// a page of thirty layouts should not be thirty round trips.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { currentUserId } from "@/lib/auth";
import { requireClanByTag } from "@/lib/clans";
import { isLeadership } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import {
  LAYOUT_TYPES,
  TH_LEVELS,
  layoutsForClan,
  removeLayout,
  unvoteLayout,
  voteForLayout,
  type LayoutRow,
  type LayoutType,
} from "@/repositories/layouts";

export const dynamic = "force-dynamic";

/** How long a signed image link stays good. Long enough to read the page. */
const SIGNED_URL_TTL = 60 * 60;

function isType(value: string | undefined): value is LayoutType {
  return value !== undefined && (LAYOUT_TYPES as string[]).includes(value);
}

/**
 * Vote, unvote, or remove. One action, because they share every guard.
 *
 * Voting goes through 028's definer functions rather than a direct write — the
 * counter on base_layouts and the row in base_layout_votes have to move
 * together, and `authenticated` has no insert grant on the votes table
 * precisely so this is the only path. Removal is a soft delete (R4) and its
 * policy already limits it to the uploader or leadership, so this does not
 * re-check that: a second opinion here could disagree with the first, and the
 * first is the one that counts.
 */
async function act(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanTag = String(formData.get("clanTag") ?? "");
  const layoutId = String(formData.get("layoutId") ?? "");
  const action = String(formData.get("action") ?? "");

  const clan = await requireClanByTag(supabase, clanTag);
  const here = `/${encodeURIComponent(clan.tag)}/layouts`;

  let result: { error?: string } = {};
  let done = "";
  if (action === "vote") {
    result = await voteForLayout(supabase, layoutId);
    done = "voted";
  } else if (action === "unvote") {
    result = await unvoteLayout(supabase, layoutId);
    done = "unvoted";
  } else if (action === "remove") {
    result = await removeLayout(supabase, clan.id, layoutId);
    done = "layout-removed";
  } else {
    redirect(`${here}?error=unknown-action`);
  }

  if (result.error) redirect(`${here}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(here);
  redirect(`${here}?ok=${done}`);
}

function LayoutCard({
  layout,
  clanTag,
  imageUrl,
  canRemove,
}: {
  layout: LayoutRow;
  clanTag: string;
  imageUrl: string | null;
  canRemove: boolean;
}) {
  return (
    <article className="space-y-3 rounded-lg border p-4">
      {imageUrl ? (
        // next/image cannot optimise a signed URL that expires, and proxying it
        // through the optimiser would cache clan material on a public CDN path.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`Town Hall ${layout.thLevel} ${layout.layoutType} base`}
          className="bg-muted aspect-video w-full rounded object-cover"
          loading="lazy"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex aspect-video w-full items-center justify-center rounded text-sm">
          No screenshot
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">TH{layout.thLevel}</Badge>
        <Badge variant="outline">{layout.layoutType}</Badge>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">
          {layout.votes} {layout.votes === 1 ? "vote" : "votes"}
        </span>
      </div>

      {layout.description && <p className="text-sm">{layout.description}</p>}

      <p className="text-muted-foreground text-xs">
        {/* An unverified account has no player name. "A member" is honest; an
            email address in a shared library is not. */}
        Shared by {layout.uploaderName ?? "a member"}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          {/* rel=noreferrer as well as noopener: this leaves the app for a
              Supercell domain and there is no reason to hand over the path. */}
          <a href={layout.copyLink} target="_blank" rel="noopener noreferrer">
            Open in game
          </a>
        </Button>

        <form action={act}>
          <input type="hidden" name="clanTag" value={clanTag} />
          <input type="hidden" name="layoutId" value={layout.id} />
          <input type="hidden" name="action" value={layout.votedByMe ? "unvote" : "vote"} />
          <SubmitButton size="sm" variant={layout.votedByMe ? "secondary" : "outline"}>
            {layout.votedByMe ? "Voted" : "Vote"}
          </SubmitButton>
        </form>

        {canRemove && (
          <form action={act} className="ml-auto">
            <input type="hidden" name="clanTag" value={clanTag} />
            <input type="hidden" name="layoutId" value={layout.id} />
            <input type="hidden" name="action" value="remove" />
            <SubmitButton size="sm" variant="ghost">
              Remove
            </SubmitButton>
          </form>
        )}
      </div>
    </article>
  );
}

export default async function LayoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ th?: string; type?: string; error?: string }>;
}) {
  const { clanTag } = await params;
  const { th, type, error } = await searchParams;

  const supabase = await createClient();
  const clan = await requireClanByTag(supabase, clanTag);
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const base = `/${encodeURIComponent(clan.tag)}/layouts`;
  const thLevel = th && /^\d+$/.test(th) ? Number(th) : null;
  const layoutType = isType(type) ? type : null;

  const layouts = await layoutsForClan(supabase, clan.id, userId, { thLevel, layoutType });

  // One batch, not one per card.
  const paths = layouts.map((l) => l.imageUrl).filter((p): p is string => Boolean(p));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage
      .from("layouts")
      .createSignedUrls(paths, SIGNED_URL_TTL);
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
    }
  }

  const leadership = isLeadership(clan.role);

  /** Preserve the other filter when changing one, so they compose. */
  function filterHref(next: { th?: number | null; type?: LayoutType | null }): string {
    const query = new URLSearchParams();
    const nextTh = next.th === undefined ? thLevel : next.th;
    const nextType = next.type === undefined ? layoutType : next.type;
    if (nextTh) query.set("th", String(nextTh));
    if (nextType) query.set("type", nextType);
    const s = query.toString();
    return s ? `${base}?${s}` : base;
  }

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="cb-title text-3xl">Base layouts</h1>
          <p className="text-muted-foreground text-sm">
            {clan.name} — shared by members, ranked by votes.
          </p>
        </div>
        <Button asChild>
          <Link href={`${base}/upload`}>Share a layout</Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            {error === "unknown-action" ? "Unrecognised action." : error}
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">Town Hall</span>
          <Link
            href={filterHref({ th: null })}
            className={`rounded-md px-2 py-1 text-sm ${thLevel === null ? "bg-accent font-medium" : "hover:bg-accent"}`}
          >
            Any
          </Link>
          {TH_LEVELS.map((level) => (
            <Link
              key={level}
              href={filterHref({ th: level })}
              className={`rounded-md px-2 py-1 text-sm ${thLevel === level ? "bg-accent font-medium" : "hover:bg-accent"}`}
            >
              {level}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">Type</span>
          <Link
            href={filterHref({ type: null })}
            className={`rounded-md px-2 py-1 text-sm ${layoutType === null ? "bg-accent font-medium" : "hover:bg-accent"}`}
          >
            Any
          </Link>
          {LAYOUT_TYPES.map((t) => (
            <Link
              key={t}
              href={filterHref({ type: t })}
              className={`rounded-md px-2 py-1 text-sm ${layoutType === t ? "bg-accent font-medium" : "hover:bg-accent"}`}
            >
              {t}
            </Link>
          ))}
        </div>
      </section>

      {layouts.length === 0 ? (
        // T9.10 — an empty library is the normal state of a new clan, and the
        // two reasons for it need different answers.
        <section className="cb-panel space-y-3 rounded-panel border p-5">
          <h2 className="font-medium">
            {thLevel || layoutType ? "Nothing matches that filter" : "No layouts yet"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {thLevel || layoutType ? (
              <>
                Try <Link href={base} className="underline">clearing the filters</Link>.
              </>
            ) : (
              "Nobody has shared a base yet. Copy a layout link in game, take a screenshot, and add the first one."
            )}
          </p>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {layouts.map((layout) => (
            <LayoutCard
              key={layout.id}
              layout={layout}
              clanTag={clan.tag}
              imageUrl={layout.imageUrl ? (signed.get(layout.imageUrl) ?? null) : null}
              canRemove={leadership || layout.uploadedBy === userId}
            />
          ))}
        </section>
      )}
    </main>
  );
}

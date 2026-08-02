// Admin — first-run bootstrap and clan management.
//
// (T9.2 adds sync_log health and a manual sync trigger to this page later.)
//
// THE BOOTSTRAP PROBLEM this solves, from migration 015:
//
//   seeing anything -> needs a clan_roles row
//   clan_roles      -> needs a clan to exist
//   a clan          -> needs a leader to add it
//   a leader        -> needs to see something
//
// 015 broke the cycle with claim_platform_ownership() and nothing has ever called
// it. This page does. The order is: sign in, claim, add clans, grant yourself
// leader — after which every later permission is per clan again, as designed.
//
// R3 — every mutation here is authorised by the database, not by this file. The
// claim is a definer function that refuses if an admin already exists; the clan
// insert is gated by 015's "platform admin adds clans" policy; the role insert by
// "admin or leader grants roles". The checks below decide what to RENDER. They
// are not the security boundary and must never be the only check.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentUserId, isPlatformAdmin } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { InvalidTagError, normaliseTag } from "@/lib/tags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

async function claimOwnership() {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // The second of the two independent checks 015 asks for. The function itself
  // enforces "only if no admin exists yet"; this enforces "only this address".
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || user.email?.trim().toLowerCase() !== owner) {
    redirect("/admin?error=not-owner");
  }

  const { error } = await supabase.rpc("claim_platform_ownership");
  if (error) redirect(`/admin?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin");
  redirect("/admin");
}

async function addClan(formData: FormData) {
  "use server";

  const supabase = await createClient();

  let tag: string;
  try {
    // Normalised before it reaches the database so the stored form is canonical
    // (section 4: uppercase, with the hash). 001's clans_tag_format constraint
    // is the backstop, but a rejected insert is a worse error message than this.
    tag = normaliseTag(String(formData.get("tag") ?? ""));
  } catch (error) {
    if (error instanceof InvalidTagError) {
      redirect("/admin?error=bad-tag");
    }
    throw error;
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin?error=no-name");

  // Only name and tag. badge_url and everything else about a clan is a game fact
  // filled in by scripts/sync/clans.ts on its first run (R11) — typing it here
  // would be inventing data the API owns.
  const { error } = await supabase.from("clans").insert({ tag, name });

  if (error) {
    const reason = /duplicate key/.test(error.message) ? "duplicate" : error.message;
    redirect(`/admin?error=${encodeURIComponent(reason)}`);
  }

  revalidatePath("/admin");
  redirect("/admin");
}

async function grantSelfLeader(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanId = String(formData.get("clanId") ?? "");
  if (!clanId) redirect("/admin?error=no-clan");

  const { error } = await supabase
    .from("clan_roles")
    .insert({ user_id: userId, clan_id: clanId, role: "leader" });

  if (error) redirect(`/admin?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin");
  redirect("/admin");
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const admin = await isPlatformAdmin(supabase, userId);
  const clans = await visibleClans(supabase, userId);
  const isLeaderSomewhere = clans.some((c) => c.role === "leader");

  // "platform admin reads all clans" (015) means an admin sees every clan;
  // everyone else sees only their own. Either way this is the list they may act
  // on, and RLS decided it — not this page.
  const { data: allClans } = await supabase
    .from("clans")
    .select("id, tag, name")
    .is("deleted_at", null)
    .order("tag");

  const clanRows = (allClans ?? []) as Array<{ id: string; tag: string; name: string }>;
  const myClanIds = new Set(clans.map((c) => c.id));

  // Whether the platform has an owner at all. A non-admin can see zero rows here
  // either because there is no admin or because RLS hid one — which is exactly
  // why the claim is guarded by the function and OWNER_EMAIL rather than by this.
  const { count: adminCount } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("is_platform_admin", true)
    .is("deleted_at", null);

  const unclaimed = !admin && (adminCount ?? 0) === 0;

  if (!admin && !isLeaderSomewhere && !unclaimed) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Nothing here yet</h1>
        {clans.length === 0 ? (
          // Approved, but belonging to no clan. Only reachable when a platform
          // admin approves an account before there is a clan to put it in (018),
          // so say what actually needs to happen rather than "access denied".
          <p className="text-muted-foreground text-sm">
            Your account is approved but you are not in any clan yet. A leader
            needs to add you to one — ask them in game.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            You do not have administrative access.
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground text-sm">
          Clans and accounts. Sync health arrives at T9.2.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            {error === "bad-tag"
              ? "That is not a valid clan tag. Tags start with # and never contain the letter O — what looks like an O is a zero."
              : error === "duplicate"
                ? "That clan has already been added."
                : error === "not-owner"
                  ? "This account is not the configured owner. Set OWNER_EMAIL to the address you sign in with."
                  : error === "no-name"
                    ? "Give the clan a name."
                    : error}
          </AlertDescription>
        </Alert>
      )}

      {unclaimed && (
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Claim this platform</h2>
          <p className="text-muted-foreground text-sm">
            Nobody owns this installation yet. Claiming it makes you the platform
            admin, approves your account, and lets you add the clans. This can only
            happen once, and only from the address in <code>OWNER_EMAIL</code>.
          </p>
          <form action={claimOwnership}>
            <Button type="submit">Claim ownership</Button>
          </form>
        </section>
      )}

      {admin && (
        <section className="space-y-4 rounded-lg border p-6">
          <div className="space-y-1">
            <h2 className="font-medium">Add a clan</h2>
            <p className="text-muted-foreground text-sm">
              The tag is all you provide. Name, badge and the member list are filled
              in by the hourly sync — they belong to the game, not to you.
            </p>
          </div>

          <form action={addClan} className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="tag">Clan tag</Label>
              <Input
                id="tag"
                name="tag"
                required
                placeholder="#2PP0JCCL"
                autoCapitalize="characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name (placeholder)</Label>
              <Input id="name" name="name" required placeholder="Clan name" />
            </div>
            <Button type="submit">Add</Button>
          </form>
        </section>
      )}

      <section className="space-y-4 rounded-lg border p-6">
        <h2 className="font-medium">Clans</h2>

        {clanRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No clans yet. Add the first one above, then run{" "}
            <code>npm run sync:clans</code> to pull in its members.
          </p>
        ) : (
          <ul className="divide-y">
            {clanRows.map((clan) => (
              <li key={clan.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{clan.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">{clan.tag}</p>
                </div>

                {myClanIds.has(clan.id) ? (
                  <Link
                    href={`/${encodeURIComponent(clan.tag)}`}
                    className="text-sm hover:underline"
                  >
                    Open
                  </Link>
                ) : (
                  admin && (
                    <form action={grantSelfLeader}>
                      <input type="hidden" name="clanId" value={clan.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Make me leader
                      </Button>
                    </form>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-lg border p-6">
        <h2 className="font-medium">Accounts</h2>
        <p className="text-muted-foreground text-sm">
          Approve or decline people waiting to join.
        </p>
        <Button asChild variant="outline">
          <Link href="/admin/members">Pending accounts</Link>
        </Button>
      </section>
    </main>
  );
}

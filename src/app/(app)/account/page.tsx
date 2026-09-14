// T11.8 — Your account, and the bases on it.
//
// The product could only ever show a member one village. players.user_id has
// accepted several since 001 and link_verified_player() has written them since
// 016, so a member with two bases already HAD two linked rows — and no page
// listed them, no way to tell them apart, and (before 031) no permission to read
// the one sitting in a clan they hold no role in.
//
// WHY /account AND NOT /settings/profile. /account is in GATE_EXEMPT (lib/gate.ts)
// and /settings is not, which decides it: a PENDING member is exactly who most
// needs to add a base, because linking one is step one of getting approved.
// Putting this under /settings would make it unreachable until after the thing it
// helps accomplish. It is deliberately NOT in SETUP_EXEMPT, so a brand-new
// account still gets a username at /account/setup first — src/lib/gate.test.ts
// asserts both halves of that pair.
//
// Structurally this is settings/account/page.tsx: force-dynamic, a module-level
// PATH, fail()/done() redirect helpers, inline server actions that re-acquire the
// client and re-validate, and a whole SENTENCE through ?ok= rather than a code,
// which messageFor() passes through unchanged. No new feedback codes are needed.
//
// R1 — every read here is PostgreSQL. R3 — basesForUser() filters by owner rather
// than by clan and its header says why at length; nothing else on this page reads
// across clans.

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, clanRoles, currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { baseLabel, nicknameProblem, normaliseNickname } from "@/lib/nickname";
import { safeMessage } from "@/lib/errors";
import {
  basesForUser,
  clearNickname,
  setNickname,
  type OwnedBase,
} from "@/repositories/account-bases";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const PATH = "/account";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

function done(message: string): never {
  redirect(`${PATH}?ok=${encodeURIComponent(message)}`);
}

export default async function AccountPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  // Four independent reads, issued together. The layout has already paid for
  // accountProfile and clanRoles this request — both are cache()d on the client
  // (T10.9) — so in practice only basesForUser and visibleClans cost anything.
  const [profile, bases, roles, clans] = await Promise.all([
    accountProfile(supabase, userId),
    basesForUser(supabase, userId),
    clanRoles(supabase, userId),
    visibleClans(supabase, userId),
  ]);

  const clanNames = new Map(clans.map((c) => [c.id, c.name]));

  /**
   * Set or clear the label on one of the member's own bases.
   *
   * An empty box means CLEAR, not "invalid". lib/nickname.ts's header states that
   * division and it is the reason nicknameProblem() is only asked about a
   * non-empty value: a member who deliberately blanked the field is not making a
   * mistake, and telling them the name is too short would be answering a question
   * they did not ask.
   *
   * No ownership check here. 033's policies are the check, and a second one in
   * application code is a second expression that has to agree with the first. A
   * playerId the member does not own comes back as a row-level security error,
   * which safeMessage() turns into a sentence rather than a Postgres string.
   */
  async function saveNickname(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (!userId) redirect("/login");

    const playerId = String(formData.get("playerId") ?? "");
    if (!playerId) fail("That base could not be identified. Reload and try again.");

    const nickname = normaliseNickname(String(formData.get("nickname") ?? ""));

    if (nickname === "") {
      const { error } = await clearNickname(supabase, playerId);
      if (error) fail(safeMessage("account clear nickname", error, "Could not clear that name."));
      revalidatePath(PATH);
      done("Base name cleared. It shows its in-game name again.");
    }

    const problem = nicknameProblem(nickname);
    if (problem) fail(problem);

    const { error } = await setNickname(supabase, playerId, userId, nickname);
    if (error) fail(safeMessage("account set nickname", error, "Could not save that name."));

    revalidatePath(PATH);
    done("Base name saved.");
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
        <p className="text-muted-foreground text-sm">
          {profile?.username ? (
            <>
              You appear as <strong>{profile.username}</strong>. Signed in as{" "}
              {profile.email}.
            </>
          ) : (
            <>Signed in as {profile?.email}.</>
          )}{" "}
          Your password and username live in{" "}
          <Link href="/settings/account" className="underline">
            sign-in and password
          </Link>
          .
        </p>
      </div>

      <section className="space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="font-medium">Your bases</h2>
          <p className="text-muted-foreground text-sm">
            Every village you have proved you own. Give each one a name if you
            have more than one — only you see these names.
          </p>
        </div>

        {bases.length === 0 ? (
          // Named for what it is rather than shown as an empty list. A member with
          // no linked base is not looking at a feature that failed; they are
          // looking at a step they have not done yet.
          <p className="text-muted-foreground text-sm">
            You have not linked a village yet. Linking one is how a leader knows
            who you are in game.
          </p>
        ) : (
          <ul className="divide-y">
            {bases.map((base) => (
              <BaseRow
                key={base.playerId}
                base={base}
                clanName={base.clanId ? clanNames.get(base.clanId) : undefined}
                inClan={Boolean(base.clanId && roles.has(base.clanId))}
                save={saveNickname}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="font-medium">Add another base</h2>
          <p className="text-muted-foreground text-sm">
            One account can hold as many villages as you play. Proving a new one
            takes the API token from its own game settings, and about a minute.
          </p>
        </div>
        {/* ?next= so Continue returns here instead of the approval page, which is
            where /verify sends a first-time member. T11.13 adds that half. */}
        <Button asChild variant="outline">
          <Link href="/verify?next=%2Faccount">
            <Plus aria-hidden className="size-4" />
            Link a village
          </Link>
        </Button>
      </section>
    </main>
  );
}

/**
 * One village in the list.
 *
 * `inClan` rather than a clan role, because the only question this row asks is
 * "can a report be built for this base" — and the answer is whether the member
 * holds any role in the clan the village currently plays in. Everything a report
 * reads (member_snapshots, wars, cwl_*) is still clan-filtered, so for a base
 * outside that set there is genuinely nothing to render.
 *
 * `clanName` is undefined for exactly that base, and the copy says so rather than
 * papering over it: `clans` RLS returns no row for a clan the member has no role
 * in, so the app CANNOT name it. That the app cannot name the clan is itself the
 * honest signal, and inventing a name from the player row is not possible.
 */
function BaseRow({
  base,
  clanName,
  inClan,
  save,
}: {
  base: OwnedBase;
  clanName?: string;
  inClan: boolean;
  save: (formData: FormData) => Promise<void>;
}) {
  const label = baseLabel(base.nickname, base.name);
  const named = label !== base.name;
  const field = `nickname-${base.playerId}`;

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{label}</span>
        {/* The in-game name stays visible whenever a label overrides it. Without
            it a member who called a base "alt" has no way to tell which village
            that is from this page. */}
        {named && <span className="text-muted-foreground text-sm">{base.name}</span>}
        <span className="text-muted-foreground font-mono text-xs">{base.tag}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {base.thLevel !== null && (
          <span className="text-muted-foreground">Town Hall {base.thLevel}</span>
        )}
        {clanName && <Badge variant="secondary">{clanName}</Badge>}
        {base.clanRole && <Badge variant="outline">{base.clanRole}</Badge>}
        {base.verified && <Badge variant="outline">verified</Badge>}
        {base.leftAt && <Badge variant="outline">left the clan</Badge>}
      </div>

      {!inClan && (
        <p className="text-muted-foreground text-sm">
          {base.clanId
            ? // Cannot name the clan — see the note above this component.
              "This base is in a clan you have no role in here, so there is no report for it yet. A leader of that clan has to add you."
            : "This base is in none of the clans on this platform, so there is nothing to report on it. It stays here because it is yours."}
        </p>
      )}

      <form action={save} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="playerId" value={base.playerId} />
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor={field} className="text-xs">
            Your name for it
          </Label>
          <Input
            id={field}
            name="nickname"
            defaultValue={base.nickname ?? ""}
            placeholder={base.name}
            maxLength={24}
          />
        </div>
        <SubmitButton variant="outline">Save</SubmitButton>
      </form>
      <p className="text-muted-foreground text-xs">
        Leave the box empty to go back to the in-game name.
      </p>
    </li>
  );
}

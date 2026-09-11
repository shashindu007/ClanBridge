// T5.7 + T9.5 — Member guide and install instructions.
//
// One page a leader can link once in WhatsApp and never explain again. It covers
// the whole path: sign in, verify, get approved, install, turn notifications on.
//
// THE IPHONE SECTION IS THE POINT OF T5.7. On iOS, Web Push exists ONLY for a
// site added to the Home Screen from Safari — not from Chrome on iOS, not from a
// normal Safari tab, and not from the share sheet of any other browser. A member
// who skips it sees a page telling them notifications are unsupported and
// reports that the app is broken. There is no way to detect and explain this at
// the moment it matters, because before installation the APIs are simply absent,
// so it has to be written down somewhere and linked to.
//
// Static and gate-exempt (lib/gate.ts): a member stuck at "pending" is exactly
// who needs to read the approval section, and putting it behind the gate would
// hide the explanation from the only people asking for it.

import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cardLabelOf, cardsInGroup, CLAN_GROUPS } from "@/lib/clan-nav";

export const metadata = {
  title: "Guide — ClanBridge",
};

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium">
        {n}
      </span>
      <div className="space-y-1 pt-0.5">
        <h3 className="font-medium">{title}</h3>
        <div className="text-muted-foreground space-y-2 text-sm">{children}</div>
      </div>
    </li>
  );
}

export default function MemberGuidePage() {
  return (
    <main className="mx-auto max-w-2xl space-y-10 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Getting started</h1>
        <p className="text-muted-foreground text-sm">
          Five minutes, once. After this the app remembers you.
        </p>
      </div>

      {/* ── Signing up ──────────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <h2 className="text-lg font-medium">Signing in</h2>

        <ol className="space-y-5">
          <Step n={1} title="Sign in with your email">
            <p>
              There is no password. Enter your email on the{" "}
              <Link href="/login" className="underline">
                sign-in page
              </Link>{" "}
              and you will be sent a link — opening it signs you in. The link works
              once and expires, so ask for a new one rather than reusing an old
              email.
            </p>
          </Step>

          <Step n={2} title="Link your Clash of Clans account">
            <p>
              The app needs to know which village is yours. In game, go to{" "}
              <strong>Settings → More Settings → API Token</strong> and copy the
              token shown there, then paste it on the{" "}
              <Link href="/verify" className="underline">
                verification page
              </Link>{" "}
              along with your player tag.
            </p>
            <p>
              The token changes every time you open that screen, so copy a fresh
              one rather than an old screenshot.
            </p>
          </Step>

          <Step n={3} title="Wait for a leader to approve you">
            <p>
              Verifying proves you own the account. A leader still has to confirm
              you belong here — until they do you will see a holding page, and
              nothing else. Ask in game if it takes more than a day.
            </p>
          </Step>
        </ol>

        {/* Verification asks members to paste a token into a website, which is
            exactly the shape of every account-theft scam in this game. Saying
            what is and is not safe is what stops a careful member refusing to
            verify — and stops a careless one handing over the real credential. */}
        <Alert>
          <AlertTitle>About that token</AlertTitle>
          <AlertDescription>
            The in-game API token is safe to share: it only proves you own the
            village, it expires quickly, and it cannot change anything in your
            account. It is <strong>not</strong> your Supercell ID password — no
            website ever needs that, and any site that asks for it is stealing
            your account.
          </AlertDescription>
        </Alert>
      </section>

      {/* ── Installing ──────────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <h2 className="text-lg font-medium">Installing it on your phone</h2>
        <p className="text-muted-foreground text-sm">
          Optional on Android, and required on iPhone if you want notifications.
        </p>

        <div className="space-y-4 rounded-lg border p-6">
          <h3 className="font-medium">Android — Chrome</h3>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
            <li>Open this site in Chrome.</li>
            <li>
              Tap the <strong>⋮</strong> menu, top right.
            </li>
            <li>
              Tap <strong>Add to Home screen</strong>, then <strong>Install</strong>.
            </li>
          </ol>
        </div>

        <div className="space-y-4 rounded-lg border p-6">
          <h3 className="font-medium">iPhone and iPad — Safari</h3>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
            <li>
              Open this site in <strong>Safari</strong>. This does not work in
              Chrome on iPhone.
            </li>
            <li>
              Tap the <strong>Share</strong> button — the square with an arrow
              coming out of it, at the bottom of the screen.
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>, then{" "}
              <strong>Add</strong>.
            </li>
            <li>Open ClanBridge from the new icon, not from Safari.</li>
          </ol>

          <Alert variant="destructive">
            <AlertTitle>On iPhone, notifications only work after this</AlertTitle>
            <AlertDescription>
              Apple only allows notifications for a site added to the Home Screen
              from Safari. If you skip this step the notification setting will
              tell you your browser cannot show notifications — that is iOS, not
              a fault. Add it to your Home Screen, open it from the icon, and try
              again.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      {/* ── Notifications ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Turning on notifications</h2>
        <p className="text-muted-foreground text-sm">
          Go to{" "}
          <Link href="/settings/notifications" className="underline">
            Notifications
          </Link>{" "}
          and turn them on. Your phone will ask for permission once — if you say
          no, the app cannot ask again and you will have to allow it in your
          browser&rsquo;s site settings.
        </p>
        <p className="text-muted-foreground text-sm">
          You get a reminder when a war day is ending and you still have an attack,
          when a poll needs your answer, and when a leader posts a notice. Each of
          those can be switched off separately on the same page.
        </p>
        <p className="text-muted-foreground text-sm">
          Notifications are per device. Turning them on on your phone does not turn
          them on on your laptop.
        </p>
      </section>

      {/* ── What it is for ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">What this replaces</h2>
        <ul className="text-muted-foreground list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>CWL history that used to be lost.</strong> Clash deletes the
            league season when it ends and it can never be recovered. This app
            captures it while it exists — every attack, every star, every missed
            day, kept permanently.
          </li>
          <li>
            <strong>The roster message that gets buried.</strong> Who is playing,
            in which clan, is on one page that is still there next week.
          </li>
          <li>
            <strong>Availability polls.</strong> One tap instead of forty replies
            a leader has to count by hand.
          </li>
          <li>
            <strong>Arguments about who did what.</strong> Every member has a
            profile showing their real record over months.
          </li>
        </ul>
      </section>

      {/* ── The page map ────────────────────────────────────────────────────
          This guide explained how to get IN and then stopped, which left a new
          member signed in, approved, notified — and looking at thirteen
          destinations with no idea which one answers their question.

          Built from lib/clan-nav.ts, the same data the rail's tab strip and the
          dashboard grid read. The hints below are the hints on those cards,
          verbatim, because they are the same sentence and a second copy written
          here would be a second copy to forget to update.

          No clan tag, so the names are listed rather than linked: this page is
          gate-exempt and a member reading it while waiting for approval has no
          clan to link into yet. */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">What each page is for</h2>
        <p className="text-muted-foreground text-sm">
          Everything below sits under whichever clan you are looking at — the
          names on the dark bar at the top. Switch clans there; the same pages
          follow.
        </p>

        <div className="space-y-5">
          {CLAN_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <h3 className="font-medium">{group.label}</h3>
              <p className="text-muted-foreground text-sm">{group.blurb}</p>
              <dl className="divide-border divide-y rounded-lg border">
                {cardsInGroup(group.id).map((section) => (
                  <div
                    key={section.path}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5"
                  >
                    <dt className="flex items-center gap-2 text-sm font-medium">
                      <section.icon
                        aria-hidden
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                      {cardLabelOf(section)}
                    </dt>
                    <dd className="text-muted-foreground text-sm">
                      {section.hint}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2 border-t pt-6">
        <h2 className="font-medium">Something is wrong</h2>
        <p className="text-muted-foreground text-sm">
          Ask a leader in game. If a page shows data that looks out of date, check
          the &ldquo;updated N minutes ago&rdquo; note on it — the app refreshes
          from Clash on a schedule rather than the instant something happens, so a
          short delay is normal.
        </p>
      </section>
    </main>
  );
}

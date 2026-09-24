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
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <h1 className="cb-title text-3xl">Guide</h1>
        {/* WHAT IT IS, BEFORE WHAT TO DO. This page opened with "Five minutes,
            once" and went straight into instructions, which assumes the reader
            already knows why they are following them. They usually do not: they
            were sent a link by a clan leader. "What this replaces" further down
            answers it well and is four screens away on a phone. One sentence
            here costs nothing and stops the reader working through a signup for
            a thing they cannot name. */}
        <p className="text-muted-foreground text-sm">
          ClanBridge keeps your clan&rsquo;s war and Clan War League record in one
          place that does not get buried in chat — and that the game itself throws
          away when a league season ends.
        </p>
        <p className="text-muted-foreground text-sm">
          Setting it up takes about five minutes, once. After that the app
          remembers you.
        </p>
      </div>

      {/* ── Signing up ────────────────────────────────────────────────────────
          FOUR STEPS, AND THEY MATCH THE PRODUCT. This section used to open with
          "There is no password", which was true of the magic-link-only design
          and stopped being true the day /account/setup shipped — one day after
          this file was last edited. It also described three steps and skipped
          the compulsory one entirely.

          The failure was not academic. A member reading it went to /login, which
          opens on the PASSWORD door, and was asked for a password they had just
          been told did not exist and did not have. This page is the one a leader
          links in WhatsApp and never explains again, so it was sending every new
          member into the one screen they could not get past.

          The order below is the order (app)/layout.tsx actually enforces —
          setup, then approval — and the numbers are the point: an unbounded
          process becomes a finite one the moment somebody can see how many steps
          are left. */}
      <section className="space-y-5">
        <h2 className="text-lg font-semibold">Getting in, the first time</h2>
        <p className="text-muted-foreground text-sm">
          Four steps. You need your phone with Clash of Clans on it for step 3.
        </p>

        <ol className="space-y-5">
          <Step n={1} title="Ask for a sign-in link">
            <p>
              On the{" "}
              <Link href="/login" className="underline">
                sign-in page
              </Link>
              , press <strong>Sign up</strong> — not the Sign in button, which is
              for people who already have an account. Enter your email and we
              send you a link. Opening it signs you in.
            </p>
            <p>
              The link works once and expires quickly, so if it has been sitting
              in your inbox a while, ask for a new one rather than reusing it.
            </p>
          </Step>

          <Step n={2} title="Choose a username and a password">
            <p>
              The link drops you straight onto a short form. Pick a{" "}
              <strong>username</strong> — 3 to 20 characters, lowercase letters,
              numbers and underscores — and a <strong>password</strong>.
            </p>
            <p>
              This step is not optional and you cannot skip past it. The username
              is how your clan sees you here; you still sign in with your email.
              The password is what lets you sign in from then on{" "}
              <strong>without waiting for an email every time</strong>, which
              matters most if you have more than one village under more than one
              address.
            </p>
          </Step>

          <Step n={3} title="Link your Clash of Clans account">
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
              Your player tag is the short code under your name on your in-game
              profile. It starts with <strong>#</strong> and never contains the
              letter O — what looks like one is a zero.
            </p>
            <p>
              The token changes every time you open that screen, so copy a fresh
              one rather than an old screenshot.
            </p>
          </Step>

          <Step n={4} title="Wait for a leader to approve you">
            <p>
              Verifying proves you own the account. A leader still has to confirm
              you belong here — until they do you will see a holding page, and
              nothing else. That page does not refresh by itself, so reload it to
              check. Ask in game if it takes more than a day.
            </p>
          </Step>
        </ol>

        {/* The everyday path, stated separately, because it is not step five of
            anything — it is what every visit after the first looks like, and a
            member who only reads the numbered list would not know the four steps
            were a one-off. */}
        <Alert>
          <AlertTitle>After that, just email and password</AlertTitle>
          <AlertDescription>
            The four steps above happen once. From then on you sign in with your
            email and the password you chose in step 2 — no inbox needed.{" "}
            <strong>Forgotten it?</strong> Press <strong>Sign up</strong> again to
            get a link, sign in with that, then set a new password under{" "}
            <strong>Sign-in and password</strong> in the account menu. There is no
            separate reset page — the link is the reset.
          </AlertDescription>
        </Alert>

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
        <h2 className="text-lg font-semibold">Installing it on your phone</h2>
        <p className="text-muted-foreground text-sm">
          Optional on Android, and required on iPhone if you want notifications.
        </p>

        <div className="cb-panel space-y-4 rounded-panel border p-5">
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

        <div className="cb-panel space-y-4 rounded-panel border p-5">
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
        <h2 className="text-lg font-semibold">Turning on notifications</h2>
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
        <h2 className="text-lg font-semibold">What this replaces</h2>
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
        <h2 className="text-lg font-semibold">What each page is for</h2>
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

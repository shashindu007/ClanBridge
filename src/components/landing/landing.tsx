// T12.5 — what somebody who has never signed in sees at "/".
//
// Until this page existed, an anonymous visit to the site was redirected to a
// login form with no explanation of what the site was, which is fine for the
// members who already know and useless for the clanmate they just sent a link
// to. This is that explanation.
//
// A SERVER component throughout, apart from the theme toggle it borrows. There
// is no interaction here that needs JavaScript — the FAQ is <details> — so a
// visitor on a slow phone gets the whole page on first paint.
//
// Everything that looks like data comes from 042's two anon-callable
// functions: four totals, and quotes a member wrote and the platform admin
// approved. Nothing on this page is invented, and a section with nothing real
// to show is not rendered rather than filled.
//
// ACCESSIBILITY: one h1, an h2 per section, a skip link, landmarks, and every
// icon aria-hidden beside a text label. Colour comes only from the tokens in
// globals.css, which are contrast-checked in both themes.

import Link from "next/link";
import {
  BellRing,
  CalendarCheck,
  ClipboardList,
  Eye,
  History,
  LayoutGrid,
  Lock,
  MessageSquareQuote,
  PiggyBank,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
  Star,
  Swords,
  Trophy,
  Users,
  Vote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { PublicQuote, PublicStats } from "@/repositories/feedback";

const JOIN_HREF = "/login?mode=signup";
const SIGN_IN_HREF = "/login";

function Crest({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 132 132"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinejoin="round"
    >
      <path d="M66 20 L98 33 v27 c0 21-15 36-32 45-17-9-32-24-32-45V33z" />
      <path d="M66 33 v59" />
      <path d="M40 47 h52" />
    </svg>
  );
}

/** A section with its heading, so every region is named for a screen reader. */
function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-6">
      <div className="max-w-2xl space-y-2">
        <p className="text-primary text-xs font-semibold tracking-wider uppercase">{eyebrow}</p>
        <h2 id={`${id}-title`} className="cb-title text-3xl sm:text-4xl">
          {title}
        </h2>
        {intro && <p className="text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

const PROBLEMS = [
  {
    Icon: History,
    title: "League history the game deletes",
    body: "When a Clan War League season ends, Clash of Clans throws its record away and it can never be fetched again. ClanBridge saves every season as it happens.",
  },
  {
    Icon: ScrollText,
    title: "A paper logbook nobody can search",
    body: "Who attacked, who missed, who earned the bonus medal — written down by hand, and lost the moment the notebook is.",
  },
  {
    Icon: MessageSquareQuote,
    title: "Rosters buried in chat",
    body: "\"Who's in for CWL?\" asked in a group chat gets forty replies and no answer. A poll gets one tap from each member and a list.",
  },
];

const FEATURES = [
  { Icon: Swords, title: "War board", body: "The score, your attacks, and who still has to go — with targets a leader can assign or you can claim." },
  { Icon: Trophy, title: "CWL seasons kept for good", body: "Every league day, every attack and every medal, saved before the game deletes them." },
  { Icon: ClipboardList, title: "Lineups and rosters", body: "Leaders pick the war and CWL lineup across every clan they run, with nobody booked twice." },
  { Icon: Vote, title: "Polls", body: "Availability for the next war or league in one tap, with a reminder for anyone who has not answered." },
  { Icon: BellRing, title: "Notices and notifications", body: "Announcements and reminders kept in one feed, and on your phone if you want them." },
  { Icon: LayoutGrid, title: "Shared base layouts", body: "The clan's best bases by Town Hall level, ranked by the members who use them." },
  { Icon: Search, title: "Every member, every clan", body: "Find anybody across the whole family of clans, and their record, in seconds." },
  { Icon: CalendarCheck, title: "Raids and Clan Games", body: "Capital raid weekends and Clan Games points, tracked without anybody typing them in." },
];

const STEPS = [
  { title: "Get a sign-in link", body: "Enter your email and we send you a link. No password to invent yet." },
  { title: "Pick a username and password", body: "So next time you sign in directly, on any device." },
  { title: "Link your village", body: "Prove the Clash of Clans account is yours with the API token from the game's settings." },
  { title: "A leader lets you in", body: "Your clan leader approves you, and your clan's page opens up." },
];

const PRINCIPLES = [
  { Icon: Shield, title: "Nothing is ever lost", body: "No history is deleted — not by the game, and not by us. Removed means hidden, never gone." },
  { Icon: Eye, title: "One view of every clan", body: "Leaders see the whole family of clans side by side instead of three separate chats." },
  { Icon: Lock, title: "Private by default", body: "Clan data is visible only to that clan's members. Nothing about a member is public." },
  { Icon: RefreshCw, title: "Data from the game itself", body: "Scheduled syncs read Supercell's official API. Numbers are never typed in by hand." },
  { Icon: PiggyBank, title: "Free to run", body: "Built on free tiers so no clan ever has to pay to keep its own history." },
  { Icon: Users, title: "Built for members", body: "Fast on a phone, readable at a glance, and usable with a keyboard or a screen reader." },
];

const FAQ = [
  {
    q: "Who can join?",
    a: "Members of the clans on this platform. Anyone can create an account, but it only opens once you link your village and a leader of that clan approves you.",
  },
  {
    q: "Why is there an approval step?",
    a: "Linking a village proves you own a Clash of Clans account, not that you belong to our clans. A leader confirming it is what keeps clan data inside the clan.",
  },
  {
    q: "Is my data private?",
    a: "Yes. War records, rosters and notices are visible only to members of that clan. The totals and approved member comments on this page are the only things anyone can see without signing in.",
  },
  {
    q: "Does it cost anything?",
    a: "No. There is nothing to buy and nothing to subscribe to.",
  },
  {
    q: "Is this made by Supercell?",
    a: "No. It is an unofficial fan project that reads Supercell's public game API, under Supercell's Fan Content Policy.",
  },
];

const numberFormat = new Intl.NumberFormat("en");

function Rating({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={`size-4 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground/40"}`}
        />
      ))}
    </span>
  );
}

export function Landing({
  stats,
  quotes,
}: {
  stats: PublicStats | null;
  quotes: PublicQuote[];
}) {
  const statItems = stats
    ? [
        { label: "clans", value: stats.clans },
        { label: "members", value: stats.members },
        { label: "league seasons saved", value: stats.cwlSeasons },
        { label: "wars recorded", value: stats.wars },
      ]
    : [];

  return (
    <div className="min-h-screen">
      {/* First focusable element on the page, visible only when focused. */}
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <header className="cb-rail sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link
            href="/"
            className="text-rail-ink flex shrink-0 items-center gap-2 text-[1.0625rem] font-semibold tracking-tight"
          >
            <Crest className="size-5.5 shrink-0" />
            ClanBridge
          </Link>

          <nav aria-label="On this page" className="text-rail-ink-dim hidden items-center gap-1 text-sm md:flex">
            {[
              ["#features", "Features"],
              ["#how", "How it works"],
              ["#vision", "Vision"],
              ["#faq", "FAQ"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="hover:bg-accent hover:text-accent-foreground rounded-md px-2.5 py-1.5 transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden w-56 sm:block">
              <ThemeToggle compact />
            </div>
            <Button asChild size="sm">
              <Link href={SIGN_IN_HREF}>Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl space-y-20 px-4 py-10 sm:py-16">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section aria-labelledby="hero-title" className="cb-hero rounded-2xl border">
          <div className="cb-hero-stripe" />
          <div className="space-y-6 px-6 py-12 sm:px-12 sm:py-16">
            <p className="text-primary text-xs font-semibold tracking-wider uppercase">
              For Clash of Clans clans
            </p>
            <h1
              id="hero-title"
              className="cb-title max-w-3xl text-4xl leading-tight sm:text-6xl"
            >
              Your clan&apos;s record, kept — even after the game deletes it.
            </h1>
            <p className="text-muted-foreground max-w-2xl text-lg">
              Wars, league seasons, rosters, polls and notices for every clan in
              the family, in one place that does not get buried in chat.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={JOIN_HREF}>Join your clan</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href={SIGN_IN_HREF}>I already have an account</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ── Live totals. Hidden when unavailable: a public "0 members"
            would be a false claim, and an empty strip is worse than none. */}
        {statItems.length > 0 && (
          <section aria-label="ClanBridge in numbers">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {statItems.map((item) => (
                <div key={item.label} className="cb-panel rounded-xl border p-5 text-center">
                  <dd className="text-3xl font-semibold tabular-nums">
                    {numberFormat.format(item.value)}
                  </dd>
                  <dt className="text-muted-foreground mt-1 text-sm">{item.label}</dt>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* ── The problem ─────────────────────────────────────────────── */}
        <Section
          id="why"
          eyebrow="Why it exists"
          title="What it replaces"
          intro="A clan's memory used to live in three places, and each one lost it in its own way."
        >
          <ul className="grid gap-4 md:grid-cols-3">
            {PROBLEMS.map(({ Icon, title, body }) => (
              <li key={title} className="cb-panel space-y-3 rounded-xl border p-5">
                <span className="cb-emblem size-9 rounded-lg" style={{ "--emblem": "var(--warning)" } as React.CSSProperties}>
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <h3 className="cb-title text-lg">{title}</h3>
                <p className="text-muted-foreground text-sm">{body}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── Features ─────────────────────────────────────────────────── */}
        <Section
          id="features"
          eyebrow="What you can do"
          title="Everything the clan used to track by hand"
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ Icon, title, body }) => (
              <li key={title} className="cb-panel space-y-3 rounded-xl border p-5">
                <span className="cb-emblem size-9 rounded-lg" style={{ "--emblem": "var(--primary)" } as React.CSSProperties}>
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <h3 className="cb-title text-lg">{title}</h3>
                <p className="text-muted-foreground text-sm">{body}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <Section id="how" eyebrow="Getting in" title="Four steps, about five minutes">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="cb-panel space-y-2 rounded-xl border p-5">
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-full text-sm font-semibold"
                >
                  {i + 1}
                </span>
                <h3 className="font-semibold">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-sm">{step.body}</p>
              </li>
            ))}
          </ol>
          <Button asChild>
            <Link href={JOIN_HREF}>Start with step one</Link>
          </Button>
        </Section>

        {/* ── Vision ───────────────────────────────────────────────────── */}
        <Section
          id="vision"
          eyebrow="Our vision"
          title="A clan's history should outlive the season"
          intro="The game is built for the next war. ClanBridge is built for the ones already fought — so the effort members put in is remembered, and every decision about a lineup can rest on what actually happened."
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="cb-emblem size-9 shrink-0 rounded-lg" style={{ "--emblem": "var(--success)" } as React.CSSProperties}>
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <div className="space-y-1">
                  <h3 className="cb-title text-lg">{title}</h3>
                  <p className="text-muted-foreground text-sm">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── Feedback. Real, approved, or absent. ───────────────────────── */}
        {quotes.length > 0 && (
          <Section id="feedback" eyebrow="From members" title="What members say">
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {quotes.map((quote, i) => (
                <li key={i} className="cb-panel flex flex-col gap-3 rounded-xl border p-5">
                  <Rating value={quote.rating} />
                  <blockquote className="flex-1 text-sm leading-relaxed">
                    &ldquo;{quote.body}&rdquo;
                  </blockquote>
                  <p className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium">{quote.author}</span>
                    {quote.clan && <> · {quote.clan}</>}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── FAQ ─────────────────────────────────────────────────────── */}
        <Section id="faq" eyebrow="Questions" title="Before you sign up">
          <div className="max-w-3xl divide-y rounded-xl border">
            {FAQ.map((item) => (
              <details key={item.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="text-muted-foreground text-xl leading-none transition-transform group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted-foreground mt-3 text-sm">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ── Final call to action ─────────────────────────────────────── */}
        <section aria-labelledby="cta-title" className="cb-hero rounded-2xl border px-6 py-12 text-center sm:px-12">
          <h2 id="cta-title" className="cb-title text-3xl sm:text-4xl">
            Ready when your clan is.
          </h2>
          <p className="text-muted-foreground mx-auto mt-2 max-w-xl">
            Create your account, link your village, and your leader does the rest.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={JOIN_HREF}>Join your clan</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={SIGN_IN_HREF}>Sign in</Link>
            </Button>
          </div>
        </section>
      </main>
      {/* The footer — Supercell's fan content notice — comes from the root
          layout, word for word, and covers this page like every other. */}
    </div>
  );
}

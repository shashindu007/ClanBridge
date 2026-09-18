// The 404 for URLs that match no route at all.
//
// (app)/not-found.tsx is the one members actually hit, because every clan page
// resolves its tag through requireClanByTag() and ends there. This one covers
// what falls outside that group: a path with more segments than any route has,
// and anything reached before the authenticated shell.
//
// It renders inside app/layout.tsx, so it keeps the backdrop and the Fan Content
// notice — but it is OUTSIDE (app)/layout.tsx and therefore has no clan switcher
// and no session. It must not try to build one: this page is reachable without a
// session, and a database call here would turn a 404 into a 500 for exactly the
// visitor least able to do anything about it.
//
// So it is static, and its only exit is "/" — which the middleware and the root
// router between them send to the right place, whoever is asking.

import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Page not found — ClanBridge",
};

export default function RootNotFound() {
  return (
    <main className="mx-auto max-w-md p-4 sm:p-8">
      <div className="cb-panel space-y-4 rounded-xl border p-6 sm:p-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            That page is not here
          </h1>
          <p className="text-muted-foreground text-sm">
            The link is wrong or out of date. Nothing is broken.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/">Go to ClanBridge</Link>
        </Button>
      </div>
    </main>
  );
}

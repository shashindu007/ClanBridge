"use client";

// /pending said "reload this page", and an installed app has no reload button.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CheckAgainButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full sm:w-auto"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
      Check again
    </Button>
  );
}

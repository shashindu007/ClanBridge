"use client";

// "Download PDF" on the print views. The browser's own print dialog, whose
// "Save as PDF" is on every desktop and phone browser — so no PDF library, no
// second layout, and what is saved is exactly the sheet on screen.

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="gold" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden />
      {label}
    </Button>
  );
}

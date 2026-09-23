"use client";

// What a <details> needs to behave like a menu. Shared by the account menu and
// the clan menu on the rail, which are the app's only two dropdowns — there is
// no dropdown primitive in components/ui, and <details> gives open/close,
// keyboard toggling and a no-JS fallback for free.

import { usePathname } from "next/navigation";
import { useEffect, type RefObject } from "react";

export function useDetailsMenu(ref: RefObject<HTMLDetailsElement | null>) {
  const pathname = usePathname();

  // Close on navigation. <details> has no idea the page changed underneath it,
  // so without this the menu stays hanging open over the page it just sent the
  // member to.
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname, ref]);

  // Escape and click-outside, which every menu is expected to do and <details>
  // does not. pointerdown rather than click so the menu closes on press rather
  // than on release, matching the platform menus members already know.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event.target instanceof Node && !el.contains(event.target)) el.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      const el = ref.current;
      if (el?.open && event.key === "Escape") {
        el.open = false;
        // Focus goes back to the control that opened it, or the member is left
        // with no keyboard position at all.
        el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}

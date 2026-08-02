// cn() — the Tailwind class merge helper shadcn/ui components expect.
//
// clsx resolves conditionals and arrays into a class string; twMerge then drops
// earlier classes that a later one overrides. Without the merge step, passing
// `className="p-8"` to a component whose base is `p-4` yields "p-4 p-8" and the
// winner depends on stylesheet order rather than on the caller's intent.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

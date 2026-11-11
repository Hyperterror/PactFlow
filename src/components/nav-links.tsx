"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/briefs", label: "Briefs", match: ["/briefs", "/quotations"] },
  { href: "/engagements", label: "Engagements", match: ["/engagements"] },
  { href: "/agreements", label: "Agreements", match: ["/agreements"] },
  { href: "/delivery", label: "Delivery", match: ["/delivery"] },
  { href: "/collaboration", label: "Collaboration", match: ["/collaboration"] },
];

/**
 * Navigation sits on the forest rail, so the active state is a quiet ivory wash
 * with a brass rule rather than a saturated pill — the palette stays calm and
 * the marker does the pointing.
 */
export function NavLinks({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Main"
      className={cn(
        orientation === "vertical" ? "flex flex-col gap-1" : "flex items-center gap-1 overflow-x-auto",
      )}
    >
      {LINKS.map((link) => {
        const active = link.match.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
        );
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-[7px] text-sm font-medium transition-colors",
              orientation === "vertical" ? "block py-2 pr-3 pl-3.5" : "whitespace-nowrap px-3 py-2",
              active
                ? "bg-inverse-foreground/15 text-inverse-foreground"
                : "text-inverse-foreground/70 hover:bg-inverse-foreground/10 hover:text-inverse-foreground",
            )}
          >
            {active && orientation === "vertical" ? (
              <span
                aria-hidden="true"
                className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-brass"
              />
            ) : null}
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

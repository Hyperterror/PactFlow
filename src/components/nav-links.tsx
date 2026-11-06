"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/briefs", label: "Briefs", match: ["/briefs", "/quotations"] },
  { href: "/agreements", label: "Agreements", match: ["/agreements"] },
  { href: "/delivery", label: "Delivery", match: ["/delivery"] },
  { href: "/collaboration", label: "Collaboration", match: ["/collaboration"] },
];

export function NavLinks({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname() ?? "";

  return (
    <nav
      className={cn(
        orientation === "vertical" ? "flex flex-col gap-1" : "flex items-center gap-1 overflow-x-auto",
      )}
    >
      {LINKS.map((link) => {
        const active = link.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              orientation === "vertical" ? "block" : "whitespace-nowrap",
              active
                ? "bg-primary-soft text-primary"
                : "text-white/70 hover:bg-white/10 hover:text-white",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

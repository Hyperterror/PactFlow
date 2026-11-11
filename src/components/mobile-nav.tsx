"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/briefs", label: "Briefs", match: ["/briefs", "/quotations"] },
  { href: "/engagements", label: "Engagements", match: ["/engagements"] },
  { href: "/agreements", label: "Agreements", match: ["/agreements"] },
  { href: "/delivery", label: "Delivery", match: ["/delivery"] },
  { href: "/collaboration", label: "Collaboration", match: ["/collaboration"] },
];

/**
 * Below the desktop breakpoint the rail collapses into a disclosure menu.
 *
 * A horizontally scrolling strip was hiding destinations off-screen with no
 * affordance that they existed; this lists all four, keeps the active one
 * marked, and closes on navigation, Escape, or a click outside.
 */
export function MobileNav() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = LINKS.find((link) =>
    link.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );

  // Navigating anywhere closes the panel.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        className="flex w-full items-center justify-between gap-2 rounded-lg bg-inverse-foreground/10 px-3 py-2.5 text-sm font-medium text-inverse-foreground"
      >
        <span className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          {active?.label ?? "Menu"}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <ul
          id="mobile-nav-panel"
          className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-border-base bg-surface shadow-raised"
        >
          {LINKS.map((link) => {
            const isActive = link === active;
            return (
              <li key={link.href} className="border-b border-border-base last:border-b-0">
                <Link
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center px-3 text-sm font-medium",
                    isActive ? "bg-primary-soft text-primary" : "text-foreground hover:bg-surface-muted",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

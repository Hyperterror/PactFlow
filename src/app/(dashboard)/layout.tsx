import type { ReactNode } from "react";
import Link from "next/link";
import { requirePageSession } from "@/lib/auth/session";
import { NavLinks } from "@/components/nav-links";
import { MobileNav } from "@/components/mobile-nav";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { PactWordmark } from "@/components/pact-mark";

/**
 * Authenticated shell. The session is re-validated here (not just in the
 * middleware) because a JWT can outlive its persisted Session row.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requirePageSession();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-raised focus:ring-2 focus:ring-brass"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 z-30 flex flex-col gap-6 bg-surface-inverse px-4 py-5 text-primary-foreground lg:h-screen">
        <div className="flex items-center justify-between gap-2">
          <Link href="/briefs" aria-label="PactFlow home">
            <PactWordmark tileClassName="bg-[#f2efe6] text-[#193c35]" />
          </Link>
          <div className="flex items-center gap-1 lg:hidden">
            <ThemeToggle />
            <NotificationBell />
            <SignOutButton />
          </div>
        </div>

        <CommandPalette />

        <MobileNav />

        <div className="hidden flex-1 lg:block">
          <NavLinks />
        </div>

        <div className="hidden border-t border-primary-foreground/15 pt-4 lg:block">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{user.name || "Account"}</p>
            <p className="truncate text-[11px] text-primary-foreground/55">{user.email}</p>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-1">
            <div className="flex items-center gap-0.5">
              <ThemeToggle />
              <NotificationBell />
            </div>
            <SignOutButton />
          </div>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="min-w-0 px-5 py-8 sm:px-8 lg:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

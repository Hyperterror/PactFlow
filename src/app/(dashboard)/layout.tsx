import type { ReactNode } from "react";
import Link from "next/link";
import { requirePageSession } from "@/lib/auth/session";
import { NavLinks } from "@/components/nav-links";
import { NotificationBell } from "@/components/notification-bell";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Authenticated shell. The session is re-validated here (not just in the
 * middleware) because a JWT can outlive its persisted Session row.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requirePageSession();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-30 flex flex-col gap-6 bg-surface-inverse px-4 py-5 text-white lg:h-screen">
        <div className="flex items-center justify-between gap-2">
          <Link href="/briefs" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              P
            </span>
            PactFlow
          </Link>
          <div className="flex items-center gap-1 lg:hidden">
            <NotificationBell />
            <SignOutButton />
          </div>
        </div>

        <div className="lg:hidden">
          <NavLinks orientation="horizontal" />
        </div>

        <div className="hidden flex-1 lg:block">
          <NavLinks />
        </div>

        <div className="hidden items-center justify-between gap-2 border-t border-white/10 pt-4 lg:flex">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{user.name || "Account"}</p>
            <p className="truncate text-[11px] text-white/50">{user.email}</p>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <SignOutButton />
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-5 py-8 sm:px-8 lg:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

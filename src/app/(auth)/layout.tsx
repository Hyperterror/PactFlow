import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Auth shell. The brand rail is hidden on small screens so the form keeps the
 * full width where it matters.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_460px]">
      <aside className="hidden flex-col justify-between bg-surface-inverse px-10 py-12 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            P
          </span>
          PactFlow
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">Why it exists</p>
          <p className="mt-4 max-w-sm text-2xl font-medium leading-snug">
            Scope creep, unpaid invoices and &ldquo;I thought that was included&rdquo; all come from the same gap: nobody
            wrote the boundary down.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">
            PactFlow writes it down, versions it, and refuses to release the file until the money has moved.
          </p>
        </div>
        <p className="text-xs text-white/40">
          AI prepares and recommends. You approve. The backend enforces every step.
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

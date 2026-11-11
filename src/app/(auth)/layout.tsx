import type { ReactNode } from "react";
import Link from "next/link";
import { PactWordmark } from "@/components/pact-mark";

/**
 * Auth shell. The brand rail is hidden on small screens so the form keeps the
 * full width where it matters.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_460px]">
      <aside className="hidden flex-col justify-between bg-surface-inverse px-10 py-12 text-inverse-foreground lg:flex">
        <Link href="/" aria-label="PactFlow home">
          <PactWordmark tileClassName="bg-[#f2efe6] text-[#193c35]" />
        </Link>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Why it exists</p>
          <p className="mt-4 max-w-sm text-2xl font-medium leading-snug tracking-[-0.01em]">
            Scope creep, unpaid invoices and &ldquo;I thought that was included&rdquo; all come from the same gap: nobody
            wrote the boundary down.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-inverse-foreground/60">
            PactFlow writes it down, versions it, and refuses to release the file until the money has moved.
          </p>
        </div>
        <p className="max-w-sm border-t border-inverse-foreground/15 pt-4 text-xs leading-relaxed text-inverse-foreground/45">
          AI prepares and recommends. You approve. The backend enforces every step.
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

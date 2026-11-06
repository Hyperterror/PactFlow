import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { buttonClass, PillarCard, PillarEyebrow } from "@/components/ui";
import { PactWordmark } from "@/components/pact-mark";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Public landing page. Authenticated visitors go straight to their workspace;
 * anonymous visitors get the product narrative and the two entry points.
 */

type PillarSpec = {
  pillar: "agreement" | "delivery" | "relationship";
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  icon: ReactNode;
};

const PILLARS: PillarSpec[] = [
  {
    pillar: "agreement",
    eyebrow: "Agreement",
    title: "Agreement intelligence",
    body: "Draft a quotation from the brief, compare every bid side by side, annotate the differences, then sign a versioned agreement that only activates when both parties approve the same version.",
    points: ["AI quotation drafts", "Per-line pricing guidance", "Comparison workspace", "Dual-approved versions"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M14 3v4h4M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    pillar: "delivery",
    eyebrow: "Delivery",
    title: "Controlled delivery",
    body: "Every deliverable is hashed on arrival, previewed under a watermark, and released as a signed URL only after the milestone payment is captured.",
    points: ["SHA-256 integrity", "Watermarked preview", "PayPal orders v2", "Signed-URL release"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9 12l2.2 2.2L15.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    pillar: "relationship",
    eyebrow: "Relationship",
    title: "Relationship memory",
    body: "Completed projects become collaboration history: confirmed working preferences, cited summaries you can flag, and templates that start the next brief in seconds.",
    points: ["Confirmed preferences", "Cited AI summaries", "Reusable templates", "Repeat invitations"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16 7.5a2.5 2.5 0 0 1 0 5M17.5 19c0-2.2-1-4.1-2.6-5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

const FLOW = [
  "Brief",
  "Invitation",
  "Quotation",
  "Comparison",
  "Agreement",
  "Delivery",
  "Payment",
  "History",
];

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/briefs");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
      <nav className="flex items-center justify-between">
        <PactWordmark />
        <div className="flex items-center gap-2">
          <ThemeToggle className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground" />
          <Link href="/login" className={buttonClass("ghost", "sm")}>
            Sign in
          </Link>
          <Link href="/register" className={buttonClass("primary", "sm")}>
            Create account
          </Link>
        </div>
      </nav>

      <section className="mt-20 border-b border-border-base pb-14">
        <PillarEyebrow tone="brass">Freelance collaboration, made accountable</PillarEyebrow>
        <h1 className="mt-5 max-w-3xl text-pretty text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.025em] text-foreground sm:text-[3.25rem]">
          The brief ends in a signed agreement, a reviewed delivery, and a captured payment.
        </h1>
        <p className="mt-6 max-w-xl text-[0.95rem] leading-[1.7] text-muted">
          PactFlow replaces the scattered email thread with one state machine. AI prepares and recommends; a person
          approves every transition; the backend refuses anything that skips a step.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link href="/register" className={buttonClass("primary", "lg")}>
            Start a project
          </Link>
          <Link href="/login" className={buttonClass("secondary", "lg")}>
            I already have an account
          </Link>
        </div>
      </section>

      <section aria-label="Engagement flow" className="mt-10">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-soft uppercase">
          One record, 8 enforced states
        </p>
        <ol className="mt-4 flex flex-wrap items-center gap-y-2 text-xs font-medium text-muted">
          {FLOW.map((step, index) => (
            <li key={step} className="flex items-center">
              <span className="rounded-full border border-border-base bg-surface px-3 py-1 text-foreground">
                {step}
              </span>
              {index < FLOW.length - 1 ? (
                <span aria-hidden="true" className="mx-1.5 h-px w-4 bg-border-strong" />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-3">
        {PILLARS.map((pillar) => (
          <PillarCard key={pillar.title} pillar={pillar.pillar}>
            <div className="flex items-center gap-2.5">
              <span
                className={
                  pillar.pillar === "agreement"
                    ? "text-brass-strong"
                    : pillar.pillar === "delivery"
                      ? "text-primary"
                      : "text-muted"
                }
              >
                {pillar.icon}
              </span>
              <PillarEyebrow tone={pillar.pillar === "agreement" ? "brass" : "muted"}>
                {pillar.eyebrow}
              </PillarEyebrow>
            </div>
            <h2 className="mt-4 text-base font-semibold tracking-[-0.01em] text-foreground">{pillar.title}</h2>
            <p className="mt-2 flex-1 text-[0.83rem] leading-[1.65] text-muted">{pillar.body}</p>
            <ul className="mt-5 space-y-1.5 border-t border-border-base pt-4">
              {pillar.points.map((point) => (
                <li key={point} className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-border-strong" />
                  {point}
                </li>
              ))}
            </ul>
          </PillarCard>
        ))}
      </section>

      <footer className="mt-auto border-t border-border-base pt-6 pb-2 text-xs leading-relaxed text-muted-soft">
        AI prepares and recommends. You approve every transition. The backend enforces each step, so neither party can
        move the project by assertion alone.
      </footer>
    </main>
  );
}

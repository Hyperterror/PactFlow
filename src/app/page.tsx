import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { buttonClass, Card } from "@/components/ui";

/**
 * Public landing page. Authenticated visitors go straight to their workspace;
 * anonymous visitors get the product narrative and the two entry points.
 */

const PILLARS = [
  {
    title: "Agreement intelligence",
    body: "Draft a quotation from the brief, compare every bid side by side, annotate the differences, then sign a versioned agreement that only activates when both parties approve the same version.",
    points: ["AI quotation drafts", "Per-line pricing guidance", "Comparison workspace", "Dual-approved versions"],
  },
  {
    title: "Controlled delivery",
    body: "Every deliverable is hashed on arrival, previewed under a watermark, and released as a signed URL only after the milestone payment is captured.",
    points: ["SHA-256 integrity", "Watermarked preview", "PayPal orders v2", "Signed-URL release"],
  },
  {
    title: "Relationship memory",
    body: "Completed projects become collaboration history: confirmed working preferences, cited summaries you can flag, and templates that start the next brief in seconds.",
    points: ["Confirmed preferences", "Cited AI summaries", "Reusable templates", "Repeat invitations"],
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
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10">
      <nav className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            P
          </span>
          <span className="text-sm font-semibold tracking-tight">PactFlow</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost", "sm")}>
            Sign in
          </Link>
          <Link href="/register" className={buttonClass("primary", "sm")}>
            Create account
          </Link>
        </div>
      </nav>

      <section className="mt-16 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Freelance collaboration, made accountable
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
          The brief ends in a signed agreement, a reviewed delivery, and a captured payment.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          PactFlow replaces the scattered email thread with one state machine. AI prepares and recommends; a person
          approves every transition; the backend refuses anything that skips a step.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/register" className={buttonClass("primary", "lg")}>
            Start a project
          </Link>
          <Link href="/login" className={buttonClass("secondary", "lg")}>
            I already have an account
          </Link>
        </div>
      </section>

      <section className="mt-14 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-muted">
        {FLOW.map((step, index) => (
          <span key={step} className="flex items-center gap-3">
            <span className="rounded-full border border-border-base bg-surface px-3 py-1">{step}</span>
            {index < FLOW.length - 1 ? <span aria-hidden="true">→</span> : null}
          </span>
        ))}
      </section>

      <section className="mt-12 grid gap-5 md:grid-cols-3">
        {PILLARS.map((pillar) => (
          <Card key={pillar.title} className="flex flex-col p-5">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{pillar.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{pillar.body}</p>
            <ul className="mt-4 space-y-1.5">
              {pillar.points.map((point) => (
                <li key={point} className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {point}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>

      <footer className="mt-auto pt-14 text-xs text-muted">
        Runs locally with SQLite, on-disk storage, mock PayPal and a deterministic AI fallback — no external credentials
        required.
      </footer>
    </main>
  );
}

import Link from "next/link";
import { buttonClass } from "@/components/ui";

/**
 * Resources a viewer may not read answer 404 rather than 403, so this page is also
 * what a visitor sees when they open a record that belongs to someone else.
 */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">404</p>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Not found</h1>
      <p className="text-sm leading-relaxed text-muted">
        This page does not exist. If it is a brief, quotation, agreement or collaboration record, it either was
        removed or belongs to someone else — PactFlow answers the same way in both cases so it never confirms
        that a private record exists.
      </p>
      <div className="flex justify-center gap-2">
        <Link href="/briefs" className={buttonClass("primary", "md")}>
          Back to briefs
        </Link>
        <Link href="/collaboration" className={buttonClass("secondary", "md")}>
          Collaboration
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Alert, buttonClass } from "@/components/ui";

/**
 * Requirement 4.7/4.8 — a failed render still gives the user a way forward
 * instead of a blank screen.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] dashboard error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <Alert tone="danger" title="This view could not be loaded">
        {error.message || "An unexpected error occurred while loading this page."}
      </Alert>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className={buttonClass("primary", "md")}>
          Try again
        </button>
        <Link href="/briefs" className={buttonClass("secondary", "md")}>
          Back to briefs
        </Link>
      </div>
    </div>
  );
}

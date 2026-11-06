"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Alert, buttonClass } from "@/components/ui";

/**
 * Requirement 4.7 — the public surface (landing, register, login, the mock PayPal
 * screen) gets its own boundary so a failure there never leaves an unstyled error
 * page from the framework.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] app error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <Alert tone="danger" title="This page could not be loaded">
        {error.message || "An unexpected error occurred while loading this page."}
      </Alert>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} className={buttonClass("primary", "md")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary", "md")}>
          Back to the homepage
        </Link>
      </div>
    </div>
  );
}

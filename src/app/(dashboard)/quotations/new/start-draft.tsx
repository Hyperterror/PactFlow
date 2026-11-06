"use client";

import { useState } from "react";
import { Alert, buttonClass, Card, Skeleton, SkeletonCard } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { navigateAfterMutation } from "@/lib/use-server-refresh";

/**
 * Entry point for a new quotation. Two paths, both explicit: let the AI propose
 * a draft (Requirements 4.1–4.9), or start from an empty form. Either way the
 * Freelancer owns every number before it is submitted.
 */
export function StartDraft({ briefId }: { briefId: string }) {
  const [busy, setBusy] = useState<"ai" | "blank" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy("ai");
    setError(null);
    try {
      const data = await apiRequest<{ quotation: { id: string }; notice?: string | null }>(
        "/api/quotations/ai-draft",
        { method: "POST", body: JSON.stringify({ briefId }) },
      );
      navigateAfterMutation(`/quotations/${data.quotation.id}/edit`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  async function blank() {
    setBusy("blank");
    setError(null);
    try {
      const data = await apiRequest<{ quotation: { id: string } }>("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          briefId,
          lineItems: [{ description: "Project fee", price: 1 }],
          timelineDays: 14,
          notes: "Draft description of how you will deliver this brief.",
        }),
      });
      navigateAfterMutation(`/quotations/${data.quotation.id}/edit`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col p-5">
          <h2 className="text-sm font-semibold">Draft with AI</h2>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">
            Reads the brief, splits the work into line items and proposes a price for each within the client&apos;s
            budget range. You review everything before it counts as a quotation.
          </p>
          <button
            type="button"
            className={buttonClass("primary", "md", "mt-4")}
            onClick={() => void generate()}
            disabled={busy !== null}
          >
            {busy === "ai" ? "Drafting…" : "Generate draft"}
          </button>
        </Card>

        <Card className="flex flex-col p-5">
          <h2 className="text-sm font-semibold">Start from scratch</h2>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">
            Opens an empty quotation with one line item. Use this when you already know exactly how to break the work
            down.
          </p>
          <button
            type="button"
            className={buttonClass("secondary", "md", "mt-4")}
            onClick={() => void blank()}
            disabled={busy !== null}
          >
            {busy === "blank" ? "Creating…" : "Create blank quotation"}
          </button>
        </Card>
      </div>

      {busy === "ai" ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Reading the brief and pricing each line item…
          </p>
          <Card className="p-5">
            <div className="space-y-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </Card>
          <SkeletonCard rows={3} />
        </div>
      ) : null}
    </div>
  );
}

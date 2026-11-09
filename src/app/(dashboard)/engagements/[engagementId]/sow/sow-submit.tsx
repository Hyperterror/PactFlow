"use client";

import { useState, type FormEvent } from "react";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { navigateAfterMutation } from "@/lib/use-server-refresh";
import type { SowConflict } from "@/lib/engagements/sow";

/**
 * Submitting the SOW. Every conflict between the proposal and the approved
 * requirements must be resolved by a person; the revision limit is stated, not
 * defaulted silently. The result is an Agreement pending both approvals.
 */
export function SowSubmit({ engagementId, conflicts }: { engagementId: string; conflicts: SowConflict[] }) {
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [revisionLimit, setRevisionLimit] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unresolved = conflicts.filter((conflict) => !resolutions[conflict.id]).length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<{ agreementId: string }>(`/api/engagements/${engagementId}/sow`, {
        method: "POST",
        body: JSON.stringify({ revisionLimit: Number(revisionLimit), resolutions }),
      });
      navigateAfterMutation(`/agreements/${data.agreementId}`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {conflicts.length > 0 ? (
        <div className="space-y-3">
          {conflicts.map((conflict) => (
            <fieldset key={conflict.id} className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5">
              <legend className="px-1 text-xs font-semibold text-warning">Conflict — needs your decision</legend>
              <p className="text-sm">{conflict.message}</p>
              <div className="mt-2 space-y-1">
                {conflict.options.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={conflict.id}
                      value={option.value}
                      checked={resolutions[conflict.id] === option.value}
                      onChange={() => setResolutions((current) => ({ ...current, [conflict.id]: option.value }))}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">No conflicts between the proposal and the approved requirements.</p>
      )}

      <Field label="Revision rounds per deliverable" htmlFor="revision-limit" hint="Both parties see and approve this on the agreement.">
        <input
          id="revision-limit"
          type="number"
          min={1}
          max={10}
          className={inputClass}
          value={revisionLimit}
          onChange={(event) => setRevisionLimit(event.target.value)}
        />
      </Field>

      <button type="submit" className={buttonClass("primary", "md", "w-full")} disabled={busy || unresolved > 0}>
        {busy ? "Creating agreement…" : "Submit SOW for approval"}
      </button>
      <p className="text-xs leading-relaxed text-muted">
        This creates the agreement at version 1. Nothing is binding until both of you approve that version.
      </p>
    </form>
  );
}

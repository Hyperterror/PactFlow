"use client";

import { useState, type FormEvent } from "react";
import { Alert, buttonClass, Card, CardBody, Field, inputClass, textareaClass } from "@/components/ui";
import { ApiRequestError, apiRequest, errorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { navigateAfterMutation } from "@/lib/use-server-refresh";

export interface EditorLineItem {
  description: string;
  price: number;
}

interface Recommendation {
  lineItemIndex: number;
  description: string;
  dismissed: boolean;
  label: string | null;
  recommendedPrice?: number;
  priceRangeMin?: number;
  priceRangeMax?: number;
  pricingConfidence?: "LOW" | "MEDIUM" | "HIGH";
  rationale?: string;
  basis?: string;
  insufficientData?: boolean;
}

/**
 * Requirements 4.5 / 5.4 / 5.8 — the recommendation sits beside the price field
 * and never overwrites it. Dismissing is permanent for that line item, and the
 * AI-generated originals stay visible in the audit trail via `aiDraftSnapshot`.
 */
export function QuotationEditor({
  quotationId,
  briefId,
  status,
  briefBudget,
  initialLineItems,
  initialTimelineDays,
  initialNotes,
  recommendations,
  regenerationsRemaining,
}: {
  quotationId: string;
  briefId: string;
  status: string;
  briefBudget: { min: number; max: number };
  initialLineItems: EditorLineItem[];
  initialTimelineDays: number;
  initialNotes: string;
  recommendations: Recommendation[];
  regenerationsRemaining: number;
}) {
  const [items, setItems] = useState<Array<{ description: string; price: string }>>(
    initialLineItems.map((item) => ({ description: item.description, price: String(item.price) })),
  );
  const [timelineDays, setTimelineDays] = useState(String(initialTimelineDays));
  const [notes, setNotes] = useState(initialNotes);
  const [recs, setRecs] = useState<Recommendation[]>(recommendations);
  const [remaining, setRemaining] = useState(regenerationsRemaining);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | "dismiss" | "regenerate" | "discard" | null>(null);

  const total = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const editable = status === "AI_DRAFT" || status === "DRAFT";

  function updateItem(index: number, key: "description" | "price", value: string) {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, [key]: value } : item)),
    );
  }

  async function dismiss(index: number) {
    setBusy("dismiss");
    setError(null);
    try {
      await apiRequest(`/api/quotations/${quotationId}/pricing/dismiss`, {
        method: "POST",
        body: JSON.stringify({ lineItemIndex: index }),
      });
      setRecs((current) => current.filter((rec) => rec.lineItemIndex !== index));
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  /** Requirement 5.5 — line items whose price still equals the suggestion. */
  function acceptedAiPrices(): number[] {
    const accepted: number[] = [];
    items.forEach((item, index) => {
      const rec = recs.find((candidate) => candidate.lineItemIndex === index);
      if (rec && typeof rec.recommendedPrice === "number" && Number(item.price) === rec.recommendedPrice) {
        accepted.push(index);
      }
    });
    return accepted;
  }

  /** Requirement 4.6 — discard the current draft and ask the AI again. */
  async function regenerate() {
    setBusy("regenerate");
    setError(null);
    try {
      const data = await apiRequest<{ quotation: { id: string }; regenerationsRemaining: number; notice?: string | null }>(
        `/api/quotations/${quotationId}/regenerate`,
        { method: "POST" },
      );
      setRemaining(data.regenerationsRemaining);
      // The AI drafted a different quotation, so the editor that opens is a
      // record that did not exist when this page was rendered.
      navigateAfterMutation(`/quotations/${data.quotation.id}/edit`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  /** Requirement 4.9 — discard without overwriting whatever was typed. */
  async function discard() {
    setBusy("discard");
    setError(null);
    try {
      await apiRequest(`/api/quotations/${quotationId}/withdraw`, { method: "POST" });
      navigateAfterMutation(`/briefs/${briefId}`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  async function persist(): Promise<boolean> {
    setFieldErrors({});
    try {
      await apiRequest(`/api/quotations/${quotationId}`, {
        method: "PATCH",
        body: JSON.stringify({
          lineItems: items.map((item) => ({ description: item.description, price: Number(item.price) })),
          timelineDays: Number(timelineDays),
          notes,
          acceptedAiPrices: acceptedAiPrices(),
        }),
      });
      return true;
    } catch (thrown) {
      if (thrown instanceof ApiRequestError) {
        setFieldErrors(thrown.fieldMap());
        if (thrown.fields.length === 0) setError(thrown.message);
      } else {
        setError(errorMessage(thrown));
      }
      return false;
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    setNotice(null);
    if (await persist()) {
      // Only the confirmation changes: the form already holds the values the
      // server just stored, so re-reading the route would only cost the notice
      // that tells the Freelancer the save went through.
      setNotice("Draft saved.");
    }
    setBusy(null);
  }

  async function onSubmit() {
    setBusy("submit");
    setError(null);
    if (!(await persist())) {
      setBusy(null);
      return;
    }
    try {
      await apiRequest(`/api/quotations/${quotationId}/submit`, { method: "POST" });
      navigateAfterMutation(`/quotations/${quotationId}`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-5" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!editable ? (
        <Alert tone="warning">
          This quotation is {status.toLowerCase().replaceAll("_", " ")} and can no longer be edited.
        </Alert>
      ) : null}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted">
              Client budget {formatMoney(briefBudget.min)} – {formatMoney(briefBudget.max)}
            </p>
            <p className="text-sm font-semibold">Total {formatMoney(total)}</p>
          </div>

          <div className="space-y-3">
            {items.map((item, index) => {
              const rec = recs.find((candidate) => candidate.lineItemIndex === index);
              return (
                <div key={index} className="rounded-lg border border-border-base p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
                    <input
                      className={inputClass}
                      maxLength={500}
                      value={item.description}
                      onChange={(event) => updateItem(index, "description", event.target.value)}
                      placeholder="Line item"
                      aria-label={`Line item ${index + 1} description`}
                      disabled={!editable}
                    />
                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.price}
                      onChange={(event) => updateItem(index, "price", event.target.value)}
                      aria-label={`Line item ${index + 1} price`}
                      disabled={!editable}
                    />
                    <button
                      type="button"
                      className={buttonClass("ghost", "sm")}
                      onClick={() => setItems((current) => current.filter((_, position) => position !== index))}
                      disabled={!editable || items.length === 1}
                    >
                      Remove
                    </button>
                  </div>

                  {rec ? (
                    <div className="mt-2 flex flex-wrap items-start justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold text-foreground">
                          {rec.insufficientData
                            ? "Insufficient data to recommend a price"
                            : `Suggested ${formatMoney(rec.recommendedPrice ?? 0)}${
                                rec.priceRangeMin !== undefined && rec.priceRangeMax !== undefined
                                  ? ` · range ${formatMoney(rec.priceRangeMin)} – ${formatMoney(rec.priceRangeMax)}`
                                  : ""
                              }`}
                          {rec.pricingConfidence ? (
                            <span className={cn("ml-2 font-medium", rec.pricingConfidence === "LOW" && "text-warning")}>
                              {rec.pricingConfidence.toLowerCase()} confidence
                            </span>
                          ) : null}
                        </p>
                        {rec.rationale ? <p className="mt-0.5 leading-relaxed text-muted">{rec.rationale}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {typeof rec.recommendedPrice === "number" && editable ? (
                          <button
                            type="button"
                            className={buttonClass("secondary", "sm")}
                            onClick={() => updateItem(index, "price", String(rec.recommendedPrice))}
                          >
                            Use
                          </button>
                        ) : null}
                        {editable ? (
                          <button
                            type="button"
                            className={buttonClass("ghost", "sm")}
                            onClick={() => void dismiss(index)}
                            disabled={busy !== null}
                          >
                            Dismiss
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {editable ? (
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              onClick={() => setItems((current) => [...current, { description: "", price: "0" }])}
              disabled={items.length >= 50}
            >
              Add line item
            </button>
          ) : null}
          {fieldErrors.lineItems ? <p className="text-xs font-medium text-danger">{fieldErrors.lineItems}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <Field
            label="Timeline (days)"
            htmlFor="timelineDays"
            required
            error={fieldErrors.timelineDays}
            hint="Whole days between 1 and 3650."
          >
            <input
              id="timelineDays"
              className={inputClass}
              type="number"
              min="1"
              max="3650"
              step="1"
              value={timelineDays}
              onChange={(event) => setTimelineDays(event.target.value)}
              disabled={!editable}
            />
          </Field>

          <Field
            label="Notes"
            htmlFor="notes"
            required
            error={fieldErrors.notes}
            hint="How you will deliver, what you assume, and what would change the price."
          >
            <textarea
              id="notes"
              className={textareaClass}
              rows={6}
              maxLength={5000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={!editable}
            />
          </Field>
        </CardBody>
      </Card>

      {editable ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              onClick={() => void regenerate()}
              disabled={busy !== null || remaining <= 0}
              title={
                remaining <= 0
                  ? "The regeneration limit has been reached for this brief."
                  : "Discards this draft and asks the AI again."
              }
            >
              {busy === "regenerate" ? "Regenerating…" : `Regenerate with AI (${remaining} left)`}
            </button>
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              onClick={() => void discard()}
              disabled={busy !== null}
            >
              {busy === "discard" ? "Discarding…" : "Discard draft"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClass("secondary", "md")} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className={buttonClass("primary", "md")}
              onClick={() => void onSubmit()}
              disabled={busy !== null}
            >
              {busy === "submit" ? "Submitting…" : "Submit quotation"}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, Field, inputClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";
import { navigateAfterMutation, useServerRefresh } from "@/lib/use-server-refresh";

export interface TemplateView {
  id: string;
  name: string;
  createdAt: string;
  briefTitle: string;
  description: string;
  deliverables: string[];
  lineItemCount: number;
  timelineDays: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  milestoneCount: number | null;
}

/**
 * Requirements 22.1-22.3 — a template captures the structure of a completed
 * project; creating a brief from it always produces a DRAFT whose every field
 * stays editable before publication. The endpoint enforces Client-only ownership.
 */
export function TemplateActions({
  historyId,
  templates,
}: {
  historyId: string;
  templates: TemplateView[];
}) {
  const refresh = useServerRefresh();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function createTemplate() {
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/collaboration/history/${historyId}/templates`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setName("");
      setNotice("Template captured from this project.");
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function createBrief(template: TemplateView) {
    setBusy(`brief-${template.id}`);
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<{ brief: { id: string } }>(
        `/api/briefs/from-template/${template.id}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setNotice("Draft brief created. Edit any field before you publish it.");
      navigateAfterMutation(`/briefs/${data.brief.id}`);
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <CardHeader
          title="Capture a template"
          description="The agreement structure, milestone count, deliverable types and budget range are copied as-is."
        />
        <CardBody>
          <div className="space-y-3">
            <Field
              label="Template name"
              htmlFor="template-name"
              hint="Something you will recognise when starting the next project."
              required
            >
              <input
                id="template-name"
                className={inputClass}
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                placeholder="Website refresh — standard package"
              />
            </Field>
            <button
              type="button"
              className={buttonClass("primary", "md")}
              onClick={() => void createTemplate()}
              disabled={busy === "create" || name.trim().length === 0}
            >
              {busy === "create" ? "Capturing…" : "Capture template"}
            </button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Templates from this project ({templates.length})
        </h2>
        {templates.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">
            None yet. Capture one above, then reuse it to pre-fill the next brief instead of starting blank.
          </p>
        ) : (
          <div className="space-y-3">
            {templates.map((template) => (
              <Card key={template.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {template.name}
                      <Badge tone="neutral">{formatDate(template.createdAt)}</Badge>
                    </span>
                  }
                  description={template.briefTitle}
                  actions={
                    <button
                      type="button"
                      className={buttonClass("secondary", "sm")}
                      onClick={() => void createBrief(template)}
                      disabled={busy === `brief-${template.id}`}
                    >
                      {busy === `brief-${template.id}` ? "Creating…" : "Create draft brief"}
                    </button>
                  }
                />
                <CardBody>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs uppercase tracking-wide text-muted">Budget</dt>
                      <dd className="font-medium">
                        {template.budgetMin === null
                          ? "—"
                          : template.budgetMax === null
                            ? formatMoney(template.budgetMin, template.currency)
                            : `${formatMoney(template.budgetMin, template.currency)} – ${formatMoney(
                                template.budgetMax,
                                template.currency,
                              )}`}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs uppercase tracking-wide text-muted">Timeline</dt>
                      <dd className="font-medium">
                        {template.timelineDays === null ? "—" : `${template.timelineDays} days`}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs uppercase tracking-wide text-muted">Milestones</dt>
                      <dd className="font-medium">{template.milestoneCount ?? "—"}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs uppercase tracking-wide text-muted">Priced line items</dt>
                      <dd className="font-medium">{template.lineItemCount}</dd>
                    </div>
                  </dl>

                  {template.deliverables.length > 0 ? (
                    <div className="mt-3 border-t border-border-base pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Deliverables</p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-foreground">
                        {template.deliverables.map((deliverable) => (
                          <li key={deliverable}>{deliverable}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {template.description ? (
                    <p className="mt-3 border-t border-border-base pt-3 text-xs leading-relaxed text-muted">
                      {template.description}
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

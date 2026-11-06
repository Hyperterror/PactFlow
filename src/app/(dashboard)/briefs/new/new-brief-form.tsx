"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, buttonClass, Card, CardBody, CardHeader, Field, inputClass, textareaClass } from "@/components/ui";
import { ApiRequestError, apiRequest, errorMessage } from "@/lib/api-client";
import { navigateAfterMutation } from "@/lib/use-server-refresh";

const MAX_DELIVERABLES = 20;

/**
 * Requirements 2.1–2.4 — the form mirrors the Brief schema: bounded title and
 * description, 1–20 deliverables, a budget range where min ≤ max, and a target
 * date strictly in the future.
 */
export function NewBriefForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deliverables, setDeliverables] = useState<string[]>([""]);
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateDeliverable(index: number, value: string) {
    setDeliverables((current) => current.map((item, position) => (position === index ? value : item)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setPending(true);

    const cleaned = deliverables.map((item) => item.trim()).filter(Boolean);

    try {
      const created = await apiRequest<{ brief: { id: string } }>("/api/briefs", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          deliverables: cleaned,
          budgetMin: Number(budgetMin),
          budgetMax: Number(budgetMax),
          targetDate: new Date(`${targetDate}T00:00:00.000Z`).toISOString(),
        }),
      });
      navigateAfterMutation(`/briefs/${created.brief.id}`);
    } catch (thrown) {
      if (thrown instanceof ApiRequestError) {
        setFieldErrors(thrown.fieldMap());
        if (thrown.fields.length === 0) setError(thrown.message);
      } else {
        setError(errorMessage(thrown));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader title="The work" description="What has to exist when this project ends?" />
        <CardBody className="space-y-4">
          <Field label="Title" htmlFor="title" required error={fieldErrors.title} hint="Up to 200 characters.">
            <input
              id="title"
              className={inputClass}
              maxLength={200}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Brand identity refresh for a coffee subscription"
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            required
            error={fieldErrors.description}
            hint="Up to 5000 characters. State the goal, the audience and anything explicitly out of scope."
          >
            <textarea
              id="description"
              className={textareaClass}
              rows={7}
              maxLength={5000}
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="We ship single-origin coffee to 4,000 subscribers..."
            />
          </Field>

          <Field
            label="Deliverables"
            required
            error={fieldErrors.deliverables}
            hint={`Between 1 and ${MAX_DELIVERABLES} items. These become the checklist the delivery is judged against.`}
          >
            <div className="space-y-2">
              {deliverables.map((deliverable, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    maxLength={200}
                    value={deliverable}
                    onChange={(event) => updateDeliverable(index, event.target.value)}
                    placeholder={index === 0 ? "Primary logo lockup (SVG + PNG)" : "Another deliverable"}
                    aria-label={`Deliverable ${index + 1}`}
                  />
                  <button
                    type="button"
                    className={buttonClass("ghost", "sm")}
                    onClick={() => setDeliverables((current) => current.filter((_, position) => position !== index))}
                    disabled={deliverables.length === 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={buttonClass("secondary", "sm")}
                onClick={() => setDeliverables((current) => [...current, ""])}
                disabled={deliverables.length >= MAX_DELIVERABLES}
              >
                Add deliverable
              </button>
            </div>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Budget and deadline" description="The range a freelancer must quote inside." />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum (USD)" htmlFor="budgetMin" required error={fieldErrors.budgetMin}>
            <input
              id="budgetMin"
              className={inputClass}
              type="number"
              min="0.01"
              step="0.01"
              required
              value={budgetMin}
              onChange={(event) => setBudgetMin(event.target.value)}
              placeholder="2500"
            />
          </Field>
          <Field label="Maximum (USD)" htmlFor="budgetMax" required error={fieldErrors.budgetMax}>
            <input
              id="budgetMax"
              className={inputClass}
              type="number"
              min="0.01"
              step="0.01"
              required
              value={budgetMax}
              onChange={(event) => setBudgetMax(event.target.value)}
              placeholder="4000"
            />
          </Field>
          <Field label="Target completion" htmlFor="targetDate" required error={fieldErrors.targetDate}>
            <input
              id="targetDate"
              className={inputClass}
              type="date"
              required
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className={buttonClass("secondary", "md")} onClick={() => router.push("/briefs")}>
          Cancel
        </button>
        <button type="submit" className={buttonClass("primary", "md")} disabled={pending}>
          {pending ? "Saving draft…" : "Save draft"}
        </button>
      </div>
    </form>
  );
}

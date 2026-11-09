"use client";

import { useState } from "react";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, Field, inputClass, selectClass, textareaClass } from "@/components/ui";
import { SourceBadges } from "@/components/requirements-view";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { navigateAfterMutation } from "@/lib/use-server-refresh";
import type { Assumption, Requirement, RequirementsContent } from "@/lib/requirements/content";

type Engine = "llm" | "heuristic" | "manual";

const EMPTY: RequirementsContent = {
  objective: "",
  stakeholders: [],
  functional: [],
  nonFunctional: [],
  outOfScope: [],
  assumptions: [],
  constraints: [],
  successMeasures: [],
};

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function LinesField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  // The raw text is kept locally so a blank line being typed is not stripped
  // mid-edit; the parsed list is reported on every keystroke.
  const [text, setText] = useState(value.join("\n"));
  return (
    <Field label={label} htmlFor={id} hint={hint ?? "One per line."}>
      <textarea
        id={id}
        className={textareaClass}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(lines(event.target.value));
        }}
      />
    </Field>
  );
}

function newRequirement(): Requirement {
  return {
    id: "",
    title: "",
    description: "",
    priority: "MUST",
    acceptanceCriteria: [],
    sources: [],
    needsConfirmation: false,
  };
}

function RequirementEditor({
  item,
  index,
  group,
  onChange,
  onRemove,
}: {
  item: Requirement;
  index: number;
  group: "functional" | "nonFunctional";
  onChange: (patch: Partial<Requirement>) => void;
  onRemove: () => void;
}) {
  const prefix = `${group}-${index}`;
  const label = item.id || `New ${group === "functional" ? "requirement" : "quality requirement"} ${index + 1}`;
  return (
    <li className="space-y-2 rounded-lg border border-border-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{label}</span>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onRemove}>
          Remove {label}
        </button>
      </div>
      <Field label={`${label} title`} htmlFor={`${prefix}-title`}>
        <input
          id={`${prefix}-title`}
          className={inputClass}
          value={item.title}
          maxLength={200}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </Field>
      <Field label={`${label} description`} htmlFor={`${prefix}-description`}>
        <textarea
          id={`${prefix}-description`}
          className={textareaClass}
          value={item.description}
          maxLength={2000}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </Field>
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Priority" htmlFor={`${prefix}-priority`}>
          <select
            id={`${prefix}-priority`}
            className={selectClass}
            value={item.priority}
            onChange={(event) => onChange({ priority: event.target.value as Requirement["priority"] })}
          >
            <option value="MUST">Must</option>
            <option value="SHOULD">Should</option>
            <option value="COULD">Could</option>
          </select>
        </Field>
        <LinesField
          id={`${prefix}-criteria`}
          label={`${label} acceptance criteria`}
          value={item.acceptanceCriteria}
          onChange={(acceptanceCriteria) => onChange({ acceptanceCriteria })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={item.needsConfirmation}
          onChange={(event) => onChange({ needsConfirmation: event.target.checked })}
        />
        {label} needs confirmation
      </label>
      <SourceBadges sources={item.sources} />
    </li>
  );
}

function AssumptionEditor({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: Assumption;
  index: number;
  onChange: (patch: Partial<Assumption>) => void;
  onRemove: () => void;
}) {
  const label = item.id || `New assumption ${index + 1}`;
  return (
    <li className="space-y-2 rounded-lg border border-border-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{label}</span>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onRemove}>
          Remove {label}
        </button>
      </div>
      <Field label={`${label} text`} htmlFor={`assumption-${index}`}>
        <textarea
          id={`assumption-${index}`}
          className={textareaClass}
          value={item.text}
          maxLength={500}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={item.status === "CONFIRMED"}
          onChange={(event) =>
            onChange({ status: event.target.checked ? "CONFIRMED" : "NEEDS_CONFIRMATION" })
          }
        />
        Confirm {label}
        {item.status === "CONFIRMED" && item.confirmedBy ? (
          <span className="text-xs text-muted">
            (confirmed by {item.confirmedBy === "CLIENT" ? "Client" : "Freelancer"})
          </span>
        ) : null}
      </label>
      <SourceBadges sources={item.sources} />
    </li>
  );
}

/**
 * Editing never changes a saved version: "Save" creates the next one. The AI
 * draft only fills this form — a person reviews it and saves it, and the
 * server re-checks IDs, sources and confirmations either way.
 */
export function RequirementsEditor({
  engagementId,
  baseVersion,
  initial,
}: {
  engagementId: string;
  baseVersion: number;
  initial: RequirementsContent | null;
}) {
  const [content, setContent] = useState<RequirementsContent>(initial ?? EMPTY);
  const [engine, setEngine] = useState<Engine>("manual");
  const [formKey, setFormKey] = useState(0);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function update<K extends keyof RequirementsContent>(key: K, value: RequirementsContent[K]) {
    setContent((current) => ({ ...current, [key]: value }));
  }

  // List edits are applied to the latest state, never to the list as it was at
  // render time, so two quick edits in a row cannot overwrite each other.
  function updateList<K extends "functional" | "nonFunctional" | "assumptions">(
    key: K,
    change: (items: RequirementsContent[K]) => RequirementsContent[K],
  ) {
    setContent((current) => ({ ...current, [key]: change(current[key]) }));
  }

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const data = await apiRequest<{
        generated: boolean;
        content: RequirementsContent | null;
        engine: "llm" | "heuristic";
        notice: string | null;
      }>(`/api/engagements/${engagementId}/requirements/draft`, { method: "POST" });
      if (data.generated && data.content) {
        setContent(data.content);
        setEngine(data.engine);
        // Remount the line-list fields so they pick up the drafted text.
        setFormKey((key) => key + 1);
        setNotice(
          `AI draft loaded (${data.engine === "llm" ? "language model" : "offline rules engine"}). It is not saved — review every item, then save it as a version.${data.notice ? ` ${data.notice}` : ""}`,
        );
      } else {
        setError(data.notice ?? "The AI draft could not be produced.");
      }
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await apiRequest(`/api/engagements/${engagementId}/requirements/versions`, {
        method: "POST",
        body: JSON.stringify({
          baseVersion,
          content,
          changeSummary: summary || undefined,
          draftEngine: engine,
        }),
      });
      navigateAfterMutation(`/engagements/${engagementId}/requirements`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  const setRequirement = (group: "functional" | "nonFunctional", index: number, patch: Partial<Requirement>) =>
    updateList(group, (items) => items.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  const removeRequirement = (group: "functional" | "nonFunctional", index: number) => {
    updateList(group, (items) => items.filter((_, position) => position !== index));
    // Rows are keyed by position, so remount the line fields after a removal.
    setFormKey((key) => key + 1);
  };

  return (
    <Card>
      <CardHeader
        title={`Edit → version ${baseVersion + 1}`}
        description="Saving creates a new version and resets both approvals. Earlier versions stay readable."
        actions={
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => void draft()} disabled={busy !== null}>
            {busy === "draft" ? "Drafting…" : "Draft with AI"}
          </button>
        }
      />
      <CardBody className="space-y-5" key={formKey}>
        {notice ? (
          <Alert tone="info">
            <Badge tone="info">AI draft</Badge> {notice}
          </Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Field label="Project objective" htmlFor="objective">
          <textarea
            id="objective"
            className={textareaClass}
            value={content.objective}
            maxLength={2000}
            onChange={(event) => update("objective", event.target.value)}
          />
        </Field>
        <LinesField id="stakeholders" label="Users and stakeholders" value={content.stakeholders} onChange={(v) => update("stakeholders", v)} />

        {(["functional", "nonFunctional"] as const).map((group) => (
          <section key={group} className="space-y-2">
            <h3 className="text-sm font-semibold">
              {group === "functional" ? "Functional requirements" : "Non-functional requirements"}
            </h3>
            <ul className="space-y-2">
              {content[group].map((item, index) => (
                <RequirementEditor
                  key={`${group}-${index}-${item.id}`}
                  item={item}
                  index={index}
                  group={group}
                  onChange={(patch) => setRequirement(group, index, patch)}
                  onRemove={() => removeRequirement(group, index)}
                />
              ))}
            </ul>
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              onClick={() => updateList(group, (items) => [...items, newRequirement()])}
            >
              + Add {group === "functional" ? "functional" : "non-functional"} requirement
            </button>
          </section>
        ))}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Assumptions</h3>
          <p className="text-xs text-muted">
            Unconfirmed assumptions block approval. Confirming one records you as the party who confirmed it.
          </p>
          <ul className="space-y-2">
            {content.assumptions.map((item, index) => (
              <AssumptionEditor
                key={`assumption-${index}-${item.id}`}
                item={item}
                index={index}
                onChange={(patch) =>
                  updateList("assumptions", (items) =>
                    items.map((existing, position) => (position === index ? { ...existing, ...patch } : existing)),
                  )
                }
                onRemove={() => {
                  updateList("assumptions", (items) => items.filter((_, position) => position !== index));
                  setFormKey((key) => key + 1);
                }}
              />
            ))}
          </ul>
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            onClick={() =>
              updateList("assumptions", (items) => [
                ...items,
                { id: "", text: "", status: "NEEDS_CONFIRMATION", sources: [] },
              ])
            }
          >
            + Add assumption
          </button>
        </section>

        <LinesField id="outOfScope" label="Out of scope" value={content.outOfScope} onChange={(v) => update("outOfScope", v)} />
        <LinesField id="constraints" label="Constraints and dependencies" value={content.constraints} onChange={(v) => update("constraints", v)} />
        <LinesField id="successMeasures" label="Success measures" value={content.successMeasures} onChange={(v) => update("successMeasures", v)} />

        <Field label="What changed (optional)" htmlFor="change-summary">
          <input
            id="change-summary"
            className={inputClass}
            value={summary}
            maxLength={500}
            onChange={(event) => setSummary(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass("primary", "md")} onClick={() => void save()} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : `Save as version ${baseVersion + 1}`}
          </button>
          <a href={`/engagements/${engagementId}/requirements`} className={buttonClass("ghost", "md")}>
            Discard changes
          </a>
        </div>
      </CardBody>
    </Card>
  );
}

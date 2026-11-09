import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { Requirement, RequirementsContent, SourceRef } from "@/lib/requirements/content";

/**
 * Read-only rendering of one requirements version. Every item shows its stable
 * ID and where it came from, and anything unconfirmed says so in words — not
 * colour alone — so provenance is visible to both parties before they approve.
 */

const SOURCE_LABELS: Record<SourceRef["type"], string> = {
  BRIEF_FIELD: "Brief",
  PROPOSAL_FIELD: "Proposal",
  DISCOVERY_MESSAGE: "Discovery message",
  CLIENT_CONFIRMED_ASSUMPTION: "Confirmed by Client",
  FREELANCER_CONFIRMED_ASSUMPTION: "Confirmed by Freelancer",
  PARTY_AUTHORED: "Written by",
};

function sourceLabel(source: SourceRef): string {
  if (source.type === "PARTY_AUTHORED") {
    return `${SOURCE_LABELS.PARTY_AUTHORED} ${source.ref === "CLIENT" ? "Client" : "Freelancer"}`;
  }
  if (source.type === "BRIEF_FIELD" || source.type === "PROPOSAL_FIELD") {
    return `${SOURCE_LABELS[source.type]} · ${source.ref.replace(/^(brief|proposal)\./, "")}`;
  }
  return SOURCE_LABELS[source.type];
}

export function SourceBadges({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Sources">
      {sources.map((source, index) => (
        <li key={`${source.ref}-${index}`}>
          <span
            title={source.excerpt}
            className="inline-flex max-w-full items-center rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted ring-1 ring-border-base ring-inset"
          >
            {sourceLabel(source)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function PlainList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function RequirementItem({ item, extra }: { item: Requirement; extra?: ReactNode }) {
  return (
    <li id={item.id} className="rounded-lg border border-border-base px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{item.id}</span>
        <span className="text-sm font-semibold">{item.title}</span>
        <Badge tone="neutral">{item.priority}</Badge>
        {item.needsConfirmation ? <Badge tone="warning">Needs confirmation</Badge> : null}
      </div>
      {item.description ? <p className="mt-1 text-sm leading-relaxed text-muted">{item.description}</p> : null}
      {item.acceptanceCriteria.length > 0 ? (
        <div className="mt-1.5">
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Acceptance criteria</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm">
            {item.acceptanceCriteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-warning">No acceptance criteria yet.</p>
      )}
      <SourceBadges sources={item.sources} />
      {extra}
    </li>
  );
}

export function RequirementsView({
  content,
  renderExtra,
}: {
  content: RequirementsContent;
  /** Per-item slot, used by the review page for anchored comments. */
  renderExtra?: (itemId: string) => ReactNode;
}) {
  return (
    <div className="space-y-5">
      <Section title="Objective">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content.objective}</p>
      </Section>
      <Section title="Users and stakeholders">
        <PlainList items={content.stakeholders} empty="None listed." />
      </Section>
      <Section title="Functional requirements">
        {content.functional.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {content.functional.map((item) => (
              <RequirementItem key={item.id} item={item} extra={renderExtra?.(item.id)} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Non-functional requirements">
        {content.nonFunctional.length === 0 ? (
          <p className="text-sm text-muted">None listed.</p>
        ) : (
          <ul className="space-y-2">
            {content.nonFunctional.map((item) => (
              <RequirementItem key={item.id} item={item} extra={renderExtra?.(item.id)} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Assumptions">
        {content.assumptions.length === 0 ? (
          <p className="text-sm text-muted">None listed.</p>
        ) : (
          <ul className="space-y-2">
            {content.assumptions.map((item) => (
              <li key={item.id} id={item.id} className="rounded-lg border border-border-base px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{item.id}</span>
                  {item.status === "CONFIRMED" ? (
                    <Badge tone="success">
                      Confirmed by {item.confirmedBy === "CLIENT" ? "Client" : "Freelancer"}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Needs confirmation</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed">{item.text}</p>
                <SourceBadges sources={item.sources} />
                {renderExtra?.(item.id)}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Out of scope">
        <PlainList items={content.outOfScope} empty="No exclusions recorded." />
      </Section>
      <Section title="Constraints and dependencies">
        <PlainList items={content.constraints} empty="None listed." />
      </Section>
      <Section title="Success measures">
        <PlainList items={content.successMeasures} empty="None listed." />
      </Section>
    </div>
  );
}

import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";

/**
 * Read-only SOW. Shared by the SOW review page and the agreement page, so the
 * text a party approves on the agreement is the text they reviewed here.
 */

export interface SowViewData {
  objective: string;
  deliverables: Array<{ id: string; title: string; requirementIds: string[]; acceptanceCriteria: string[] }>;
  qualityRequirements: Array<{ id: string; title: string; acceptanceCriteria: string[] }>;
  outOfScope: string[];
  assumptions: Array<{ id: string; text: string; confirmedBy: string | null }>;
  constraints: string[];
  lineItems: Array<{ description: string; price: number }>;
  total: number;
  currency: string;
  timelineDays: number;
  proposedEndDate: string;
  briefTargetDate: string;
  paymentTerms: string;
  changeControl: string;
  requirementsVersionNumber: number;
  revisionLimit?: number;
  agreedEndDate?: string;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function SowView({ sow }: { sow: SowViewData }) {
  return (
    <div className="space-y-5">
      <Section title="Objective">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{sow.objective}</p>
      </Section>

      <Section title={`Deliverables — traced to requirements v${sow.requirementsVersionNumber}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border-base">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Deliverable</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Requirement</th>
                <th scope="col" className="py-1.5 font-semibold">Acceptance criteria</th>
              </tr>
            </thead>
            <tbody>
              {sow.deliverables.map((deliverable) => (
                <tr key={deliverable.id} className="border-b border-border-base align-top last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs font-semibold">{deliverable.id}</span>
                    <p>{deliverable.title}</p>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{deliverable.requirementIds.join(", ")}</td>
                  <td className="py-2">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {deliverable.acceptanceCriteria.map((criterion, index) => (
                        <li key={index}>{criterion}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {sow.qualityRequirements.length > 0 ? (
        <Section title="Quality requirements (apply to every deliverable)">
          <ul className="space-y-1 text-sm">
            {sow.qualityRequirements.map((item) => (
              <li key={item.id}>
                <span className="font-mono text-xs font-semibold">{item.id}</span> {item.title} —{" "}
                {item.acceptanceCriteria.join(" ")}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Out of scope">
        <List items={sow.outOfScope} empty="No exclusions recorded." />
      </Section>

      <Section title="Confirmed assumptions">
        {sow.assumptions.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {sow.assumptions.map((item) => (
              <li key={item.id}>
                <span className="font-mono text-xs font-semibold">{item.id}</span> {item.text}{" "}
                <span className="text-xs text-muted">
                  (confirmed by {item.confirmedBy === "CLIENT" ? "Client" : item.confirmedBy === "FREELANCER" ? "Freelancer" : "both on approval"})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Constraints and dependencies">
        <List items={sow.constraints} empty="None listed." />
      </Section>

      <Section title="Price and timeline (from the accepted proposal)">
        <ul className="divide-y divide-border-base">
          {sow.lineItems.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-4 py-1.5 text-sm">
              <span className="min-w-0">{item.description}</span>
              <span className="shrink-0 font-medium">{formatMoney(item.price, sow.currency)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-4 pt-2 text-sm font-semibold">
            <span>Total</span>
            <span>{formatMoney(sow.total, sow.currency)}</span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted">
          {sow.timelineDays} days · {sow.agreedEndDate ? `agreed end date ${sow.agreedEndDate}` : `proposed end ${sow.proposedEndDate}`} · brief target {sow.briefTargetDate}
          {sow.revisionLimit ? ` · ${sow.revisionLimit} revision rounds per deliverable` : ""}
        </p>
      </Section>

      <Section title="Payment terms">
        <p className="text-sm leading-relaxed">{sow.paymentTerms}</p>
      </Section>
      <Section title="Change control">
        <p className="text-sm leading-relaxed">{sow.changeControl}</p>
      </Section>
    </div>
  );
}

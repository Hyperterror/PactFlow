import { describe, expect, it } from "vitest";
import { buildScopeBaseline, classifyAgainstBaseline, enforceEvidence } from "@/lib/ai/scope-baseline";
import { normalizeContent } from "@/lib/requirements/content";

/**
 * Lifecycle Update PRD FR-07 / AT-09 / AT-10 — changes are judged against the
 * approved requirements and the SOW, and every label cites the items it used.
 */

const requirements = normalizeContent(
  {
    objective: "Marketing site rebuild",
    functional: [
      { title: "Homepage", description: "Hero section, testimonials and newsletter signup form", acceptanceCriteria: ["Approved by the Client"] },
      { title: "Pricing page", description: "Monthly and annual plan comparison table", acceptanceCriteria: ["Shows both plans"] },
    ],
    nonFunctional: [{ title: "Responsive layout", acceptanceCriteria: ["Works on phone widths"] }],
    outOfScope: ["Photography and video production are priced separately.", "Blog migration from the old CMS."],
  },
  "CLIENT",
  [],
);

const agreementContent = {
  sow: {
    deliverables: [
      { id: "DEL-001", title: "Homepage", requirementIds: ["REQ-001"] },
      { id: "DEL-002", title: "Pricing page", requirementIds: ["REQ-002"] },
    ],
    outOfScope: requirements.outOfScope,
  },
};

const baseline = buildScopeBaseline({
  agreementVersionNumber: 1,
  agreementContent,
  requirements: { versionNumber: 3, content: requirements },
});

describe("buildScopeBaseline", () => {
  it("combines approved requirements and SOW deliverables under stable refs", () => {
    expect(baseline.label).toBe("Requirements v3 + Agreement v1 (SOW)");
    expect(baseline.items.map((item) => item.ref)).toEqual(
      expect.arrayContaining(["REQ-001", "REQ-002", "NFR-001", "OOS-001", "OOS-002", "DEL-001", "DEL-002"]),
    );
    // Exclusions come from the BRD once, not again from the SOW copy.
    expect(baseline.items.filter((item) => item.kind === "OUT_OF_SCOPE")).toHaveLength(2);
  });

  it("falls back to the agreement's own deliverables for a legacy agreement", () => {
    const legacy = buildScopeBaseline({
      agreementVersionNumber: 2,
      agreementContent: { description: "Brand refresh", deliverables: ["Logo", "Style guide"] },
      requirements: null,
    });
    expect(legacy.label).toBe("Agreement v2");
    expect(legacy.items.map((item) => item.ref)).toEqual(["SCOPE-001", "SCOPE-002", "SCOPE-DESC"]);
  });
});

describe("classifyAgainstBaseline", () => {
  it("AT-09: an included change cites the requirement that covers it", () => {
    const result = classifyAgainstBaseline("Add the annual plan comparison table to the pricing page", baseline);
    expect(result.label).toBe("INCLUDED");
    expect(result.evidence[0]).toMatchObject({ ref: "REQ-002", relation: "COVERED_BY" });
    expect(result.rationale).toContain("REQ-002");
  });

  it("AT-10: a change matching an explicit exclusion is outside scope, citing the exclusion", () => {
    const result = classifyAgainstBaseline("Please also handle the blog migration from our old CMS", baseline);
    expect(result.label).toBe("OUTSIDE_SCOPE");
    expect(result.evidence[0]).toMatchObject({ ref: "OOS-002", relation: "EXCLUDED_BY" });
  });

  it("AT-10: unrelated work is outside scope and names the closest items checked", () => {
    const result = classifyAgainstBaseline("Build an iOS mobile app with push notifications and offline sync", baseline);
    expect(result.label).toBe("OUTSIDE_SCOPE");
    expect(result.evidence.every((entry) => entry.relation === "NEAREST_TERM")).toBe(true);
  });

  it("AT-10: a change that partly overlaps is ambiguous with partial evidence", () => {
    const result = classifyAgainstBaseline(
      "Extend the homepage newsletter signup with a referral rewards program and leaderboard",
      baseline,
    );
    expect(result.label).toBe("AMBIGUOUS");
    expect(result.evidence.some((entry) => entry.ref === "REQ-001" && entry.relation === "PARTIALLY_COVERED_BY")).toBe(true);
  });

  it("never returns a rationale shorter than the stored minimum", () => {
    for (const text of ["", "pricing page", "an entirely new android application"]) {
      expect(classifyAgainstBaseline(text, baseline).rationale.length).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("enforceEvidence", () => {
  it("drops invented refs and downgrades a decisive label left without evidence", () => {
    const result = enforceEvidence(
      {
        label: "INCLUDED",
        rationale: "The model is confident this is covered by the agreed requirements of the project.",
        evidence: [{ ref: "REQ-999", relation: "COVERED_BY", text: "made up", matchedTerms: [] }],
      },
      baseline,
    );
    expect(result.label).toBe("AMBIGUOUS");
    expect(result.evidence).toEqual([]);
  });

  it("keeps real refs and replaces the model's text with the baseline text", () => {
    const result = enforceEvidence(
      {
        label: "OUTSIDE_SCOPE",
        rationale: "The request matches an exclusion the parties agreed on for photography work.",
        evidence: [{ ref: "OOS-001", relation: "EXCLUDED_BY", text: "whatever the model said", matchedTerms: ["photography"] }],
      },
      baseline,
    );
    expect(result.label).toBe("OUTSIDE_SCOPE");
    expect(result.evidence[0].text).toBe("Photography and video production are priced separately.");
  });
});

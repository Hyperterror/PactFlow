import { describe, expect, it } from "vitest";
import {
  approvalBlockers,
  normalizeContent,
  type RequirementsContent,
  type RequirementsContentInput,
} from "@/lib/requirements/content";

/**
 * Lifecycle Update PRD FR-04 — stable IDs, provenance on every item, and
 * confirmations attributed by the server, never by the browser.
 */

function base(overrides: Partial<RequirementsContentInput> = {}): RequirementsContentInput {
  return {
    objective: "Rebuild the marketing site.",
    functional: [
      {
        title: "Homepage",
        acceptanceCriteria: ["Homepage approved by the Client."],
        sources: [{ type: "BRIEF_FIELD", ref: "brief.deliverables[0]" }],
      },
    ],
    ...overrides,
  };
}

describe("normalizeContent — stable IDs", () => {
  it("assigns sequential IDs per kind on the first version", () => {
    const content = normalizeContent(
      base({
        functional: [{ title: "A" }, { title: "B" }],
        nonFunctional: [{ title: "Responsive" }],
        assumptions: [{ text: "Copy is supplied by the Client." }],
      }),
      "CLIENT",
      [],
    );
    expect(content.functional.map((item) => item.id)).toEqual(["REQ-001", "REQ-002"]);
    expect(content.nonFunctional.map((item) => item.id)).toEqual(["NFR-001"]);
    expect(content.assumptions.map((item) => item.id)).toEqual(["ASM-001"]);
  });

  it("keeps existing IDs and never reuses a removed one", () => {
    const v1 = normalizeContent(base({ functional: [{ title: "A" }, { title: "B" }] }), "CLIENT", []);
    // REQ-002 is removed in v2 and a new item is added.
    const v2 = normalizeContent(
      { ...v1, functional: [v1.functional[0], { title: "C" }] },
      "FREELANCER",
      [v1],
    );
    expect(v2.functional.map((item) => item.id)).toEqual(["REQ-001", "REQ-003"]);

    // Even re-adding an item later does not bring REQ-002 back.
    const v3 = normalizeContent({ ...v2, functional: [...v2.functional, { title: "D" }] }, "CLIENT", [v1, v2]);
    expect(v3.functional.map((item) => item.id)).toEqual(["REQ-001", "REQ-003", "REQ-004"]);
  });

  it("replaces made-up and duplicated IDs", () => {
    const v1 = normalizeContent(base(), "CLIENT", []);
    const v2 = normalizeContent(
      {
        ...v1,
        functional: [
          v1.functional[0],
          { ...v1.functional[0], title: "Copy with same id" },
          { id: "REQ-999", title: "Invented id" },
        ],
      },
      "CLIENT",
      [v1],
    );
    expect(v2.functional.map((item) => item.id)).toEqual(["REQ-001", "REQ-002", "REQ-003"]);
  });
});

describe("normalizeContent — provenance and confirmation", () => {
  it("attributes an unsourced item to its author", () => {
    const content = normalizeContent(base({ functional: [{ title: "Typed in by hand" }] }), "FREELANCER", []);
    expect(content.functional[0].sources).toEqual([{ type: "PARTY_AUTHORED", ref: "FREELANCER" }]);
  });

  it("records the author as confirmer and ignores a forged confirmedBy", () => {
    const v1 = normalizeContent(base({ assumptions: [{ text: "Copy is supplied by the Client." }] }), "CLIENT", []);
    expect(v1.assumptions[0].status).toBe("NEEDS_CONFIRMATION");

    const v2 = normalizeContent(
      { ...v1, assumptions: [{ ...v1.assumptions[0], status: "CONFIRMED", confirmedBy: "CLIENT" }] },
      "FREELANCER",
      [v1],
    );
    expect(v2.assumptions[0].confirmedBy).toBe("FREELANCER");
    expect(v2.assumptions[0].sources.some((source) => source.type === "FREELANCER_CONFIRMED_ASSUMPTION")).toBe(true);

    // A later save by the other party keeps the original confirmer.
    const v3 = normalizeContent(v2, "CLIENT", [v1, v2]);
    expect(v3.assumptions[0].confirmedBy).toBe("FREELANCER");
  });

  it("adds a confirmation source when a flagged requirement is cleared", () => {
    const v1 = normalizeContent(base({ functional: [{ title: "Extra page", needsConfirmation: true }] }), "CLIENT", []);
    const v2 = normalizeContent(
      { ...v1, functional: [{ ...v1.functional[0], needsConfirmation: false }] },
      "CLIENT",
      [v1],
    );
    expect(v2.functional[0].sources.map((source) => source.type)).toContain("CLIENT_CONFIRMED_ASSUMPTION");
  });
});

describe("approvalBlockers", () => {
  const ready: RequirementsContent = normalizeContent(base(), "CLIENT", []);

  it("is empty for a complete, confirmed brief", () => {
    expect(approvalBlockers(ready)).toEqual([]);
  });

  it("blocks on unconfirmed assumptions, flagged items, missing criteria and empty scope", () => {
    const blocked = normalizeContent(
      base({
        functional: [{ title: "No criteria" }, { title: "Flagged", acceptanceCriteria: ["x"], needsConfirmation: true }],
        assumptions: [{ text: "Unconfirmed" }],
      }),
      "CLIENT",
      [],
    );
    const messages = approvalBlockers(blocked).map((blocker) => blocker.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "REQ-001 has no acceptance criteria.",
        "REQ-002 still needs confirmation.",
        "ASM-001 is an unconfirmed assumption.",
      ]),
    );
    expect(approvalBlockers({ ...ready, functional: [] }).map((blocker) => blocker.message)).toContain(
      "Add at least one functional requirement.",
    );
  });
});

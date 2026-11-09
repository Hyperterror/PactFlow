import { describe, expect, it } from "vitest";
import {
  enforceProvenance,
  heuristicRequirementsDraft,
  sourceCatalog,
  type RequirementsGrounding,
} from "@/lib/ai/requirements";
import type { RequirementsContent } from "@/lib/requirements/content";

/**
 * Lifecycle Update PRD AT-03 — the draft is built only from the brief, the
 * accepted proposal and discovery messages; sources are attached, and
 * unsupported content is flagged rather than promoted.
 */

const grounding: RequirementsGrounding = {
  brief: {
    title: "Marketing site",
    description: "Rebuild the marketing site so it is responsive. Photography is priced separately.",
    deliverables: ["Homepage", "Pricing page"],
    budgetMin: 2000,
    budgetMax: 5000,
    targetDate: new Date("2027-03-31T00:00:00.000Z"),
  },
  proposal: {
    lineItems: [
      { description: "Homepage build", price: 1500 },
      { description: "Pricing page with plan toggle", price: 1000 },
      { description: "Blog setup", price: 800 },
    ],
    total: 3300,
    timelineDays: 21,
    notes: "Two review rounds.",
  },
  messages: [{ id: "msg-1", authorRole: "CLIENT", content: "The pricing page must show annual and monthly plans." }],
  selectedAt: new Date("2027-01-01T00:00:00.000Z"),
};

describe("heuristicRequirementsDraft", () => {
  const draft = heuristicRequirementsDraft(grounding);

  it("turns each brief deliverable into a requirement sourced from the brief", () => {
    const homepage = draft.functional.find((item) => item.title === "Homepage")!;
    expect(homepage.sources.map((source) => source.ref)).toEqual(
      expect.arrayContaining(["brief.deliverables[0]", "proposal.lineItems[0]"]),
    );
    expect(homepage.needsConfirmation).toBe(false);
  });

  it("flags proposal scope the brief did not ask for", () => {
    const blog = draft.functional.find((item) => item.title === "Blog setup")!;
    expect(blog.needsConfirmation).toBe(true);
    expect(blog.sources).toEqual([expect.objectContaining({ type: "PROPOSAL_FIELD", ref: "proposal.lineItems[2]" })]);
  });

  it("cites discovery messages by id", () => {
    const fromDiscovery = draft.functional.find((item) =>
      item.sources.some((source) => source.type === "DISCOVERY_MESSAGE"),
    );
    expect(fromDiscovery?.sources[0].ref).toBe("message:msg-1");
  });

  it("derives non-functional requirements and exclusions only from stated text", () => {
    expect(draft.nonFunctional.map((item) => item.title)).toEqual(["Responsive layout"]);
    expect(draft.outOfScope).toEqual(["Photography is priced separately."]);
  });

  it("leaves every assumption unconfirmed", () => {
    expect(draft.assumptions.length).toBeGreaterThan(0);
    expect(draft.assumptions.every((item) => item.status === "NEEDS_CONFIRMATION")).toBe(true);
  });

  it("raises the timeline as an assumption when it overruns the target date", () => {
    const late = heuristicRequirementsDraft({ ...grounding, proposal: { ...grounding.proposal, timelineDays: 200 } });
    expect(late.assumptions[0].text).toMatch(/ends after the brief's target date/);
  });
});

describe("enforceProvenance", () => {
  const catalog = sourceCatalog(grounding);

  it("drops references that do not resolve and flags the orphaned item", () => {
    const modelOutput: RequirementsContent = {
      objective: "x",
      stakeholders: [],
      functional: [
        {
          id: "REQ-001",
          title: "Invented integration",
          description: "",
          priority: "MUST",
          acceptanceCriteria: ["works"],
          sources: [{ type: "BRIEF_FIELD", ref: "brief.deliverables[9]" }],
          needsConfirmation: false,
        },
        {
          id: "",
          title: "Homepage",
          description: "",
          priority: "MUST",
          acceptanceCriteria: ["works"],
          sources: [{ type: "PROPOSAL_FIELD", ref: "brief.deliverables[0]", excerpt: "made up" }],
          needsConfirmation: false,
        },
      ],
      nonFunctional: [],
      outOfScope: [],
      assumptions: [
        {
          id: "",
          text: "Model tried to confirm this",
          status: "CONFIRMED",
          confirmedBy: "CLIENT",
          sources: [{ type: "CLIENT_CONFIRMED_ASSUMPTION", ref: "CLIENT" }],
        },
      ],
      constraints: [],
      successMeasures: [],
    };
    const { content, dropped } = enforceProvenance(modelOutput, catalog);
    expect(dropped).toBe(2);
    expect(content.functional[0].sources).toEqual([]);
    expect(content.functional[0].needsConfirmation).toBe(true);
    // Type and excerpt come from the catalog, not the model.
    expect(content.functional[1].sources).toEqual([
      { type: "BRIEF_FIELD", ref: "brief.deliverables[0]", excerpt: "Homepage" },
    ]);
    expect(content.assumptions[0]).toEqual({ id: "", text: "Model tried to confirm this", status: "NEEDS_CONFIRMATION", sources: [] });
  });
});

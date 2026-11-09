import { beforeEach, describe, expect, it } from "vitest";
import {
  approveRequirements,
  assertEngagementParticipant,
  cancelEngagement,
  draftRequirements,
  getSowPreview,
  postMessage,
  saveRequirementsVersion,
  selectProposal,
  submitSow,
} from "@/lib/engagements";
import { approveVersion } from "@/lib/agreements";
import { submitChangeRequest } from "@/lib/change-requests";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import type { RequirementsContent } from "@/lib/requirements/content";
import { countRows, prisma, resetDatabase } from "../helpers/db";
import { createUser } from "../helpers/fixtures";

/**
 * Lifecycle Update PRD acceptance tests AT-01 to AT-08, driven through the real
 * domain module against the test database:
 * selection → engagement (no agreement) → requirements versions → mutual
 * approval of one exact version → SOW → agreement pending both approvals.
 */

let sequence = 0;

async function setup(options: { budgetMax?: number; secondProposal?: boolean } = {}) {
  sequence += 1;
  const client = await createUser(`Client ${sequence}`, `eng-client-${sequence}@example.test`);
  const freelancer = await createUser(`Freelancer ${sequence}`, `eng-freelancer-${sequence}@example.test`);
  const rival = await createUser(`Rival ${sequence}`, `eng-rival-${sequence}@example.test`);
  const brief = await prisma.brief.create({
    data: {
      clientId: client.id,
      title: `Marketing site ${sequence}`,
      description: "Rebuild the marketing site so it is responsive.",
      deliverables: ["Homepage", "Pricing page"] as object,
      budgetMin: 2000,
      budgetMax: options.budgetMax ?? 5000,
      targetDate: new Date(Date.now() + 120 * 86_400_000),
      status: "OPEN",
      publishedAt: new Date(),
    },
  });
  const quotation = await prisma.quotation.create({
    data: {
      briefId: brief.id,
      freelancerId: freelancer.id,
      status: "SUBMITTED",
      lineItems: [
        { description: "Homepage build", price: 1800 },
        { description: "Pricing page", price: 1200 },
      ] as object,
      timelineDays: 21,
      notes: "Two review rounds.",
      submittedAt: new Date(),
    },
  });
  const rivalQuotation = await prisma.quotation.create({
    data: {
      briefId: brief.id,
      freelancerId: rival.id,
      status: "SUBMITTED",
      lineItems: [{ description: "Everything", price: 2500 }] as object,
      timelineDays: 30,
      notes: "Fixed price.",
      submittedAt: new Date(),
    },
  });
  return { client, freelancer, rival, brief, quotation, rivalQuotation };
}

/** Confirms every assumption and clears every flag, as a party would in the editor. */
function confirmEverything(content: RequirementsContent): RequirementsContent {
  return {
    ...content,
    functional: content.functional.map((item) => ({ ...item, needsConfirmation: false })),
    nonFunctional: content.nonFunctional.map((item) => ({ ...item, needsConfirmation: false })),
    assumptions: content.assumptions.map((item) => ({ ...item, status: "CONFIRMED" as const })),
  };
}

async function engagementWithApprovedBaseline(options: { budgetMax?: number } = {}) {
  const parties = await setup(options);
  const { engagement } = await selectProposal(parties.brief.id, parties.client.id, parties.quotation.id);
  const draft = await draftRequirements(engagement.id, parties.client.id);
  await saveRequirementsVersion(engagement.id, parties.client.id, {
    baseVersion: 0,
    content: confirmEverything(draft.content!),
    draftEngine: draft.engine,
  });
  await approveRequirements(engagement.id, parties.client.id, 1);
  await approveRequirements(engagement.id, parties.freelancer.id, 1);
  return { ...parties, engagementId: engagement.id };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("AT-01 / AT-02 — selection opens an engagement, never an agreement", () => {
  it("creates exactly one engagement, idempotently, and no agreement", async () => {
    const { client, brief, quotation } = await setup();
    const first = await selectProposal(brief.id, client.id, quotation.id);
    const again = await selectProposal(brief.id, client.id, quotation.id);

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.engagement.id).toBe(first.engagement.id);
    expect(first.engagement.status).toBe("DISCOVERY");
    expect(await countRows("Engagement")).toBe(1);
    expect(await countRows("Agreement")).toBe(0);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).status).toBe("ACCEPTED");
  });

  it("refuses a second proposal for the same brief until the engagement is cancelled", async () => {
    const { client, brief, quotation, rivalQuotation } = await setup();
    const { engagement } = await selectProposal(brief.id, client.id, quotation.id);

    await expect(selectProposal(brief.id, client.id, rivalQuotation.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: rivalQuotation.id } })).status).toBe("SUBMITTED");

    await cancelEngagement(engagement.id, client.id, "Scope did not fit.");
    const reopened = await selectProposal(brief.id, client.id, rivalQuotation.id);
    expect(reopened.created).toBe(true);
    // The cancelled engagement and its accepted proposal are kept.
    expect(await countRows("Engagement")).toBe(2);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).status).toBe("ACCEPTED");
  });

  it("rejects selection by a non-owner and reads by a non-participant", async () => {
    const { client, freelancer, rival, brief, quotation } = await setup();
    await expect(selectProposal(brief.id, freelancer.id, quotation.id)).rejects.toBeInstanceOf(ForbiddenError);

    const { engagement } = await selectProposal(brief.id, client.id, quotation.id);
    await expect(assertEngagementParticipant(engagement.id, rival.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(postMessage(engagement.id, rival.id, "hello")).rejects.toBeInstanceOf(ForbiddenError);
    const violations = await prisma.auditLog.count({ where: { eventType: "ACCESS_VIOLATION", actorId: rival.id } });
    expect(violations).toBeGreaterThanOrEqual(2);
  });
});

describe("AT-03 to AT-06 — versioned requirements and mutual approval", () => {
  it("drafts from real sources, blocks approval on unconfirmed items, and needs both parties on one version", async () => {
    const { client, freelancer, brief, quotation } = await setup();
    const { engagement } = await selectProposal(brief.id, client.id, quotation.id);
    const message = await postMessage(engagement.id, client.id, "The pricing page must show annual and monthly plans.");

    const draft = await draftRequirements(engagement.id, freelancer.id);
    expect(draft.generated).toBe(true);
    const refs = draft.content!.functional.flatMap((item) => item.sources.map((source) => source.ref));
    expect(refs).toContain("brief.deliverables[0]");
    expect(refs).toContain(`message:${message.id}`);
    // Nothing is saved by drafting.
    expect(await countRows("RequirementsVersion")).toBe(0);

    // v1 saved as drafted: assumptions are unconfirmed, so approval is blocked.
    await saveRequirementsVersion(engagement.id, freelancer.id, { baseVersion: 0, content: draft.content!, draftEngine: draft.engine });
    expect((await prisma.engagement.findUniqueOrThrow({ where: { id: engagement.id } })).status).toBe("REQUIREMENTS");
    await expect(approveRequirements(engagement.id, client.id, 1)).rejects.toBeInstanceOf(ValidationError);

    // v2 confirms everything; v1 stays immutable and is superseded.
    const v1 = await prisma.requirementsVersion.findFirstOrThrow({ where: { engagementId: engagement.id, versionNumber: 1 } });
    await saveRequirementsVersion(engagement.id, freelancer.id, {
      baseVersion: 1,
      content: confirmEverything(draft.content!),
      changeSummary: "Confirmed timeline",
    });
    const v1After = await prisma.requirementsVersion.findFirstOrThrow({ where: { id: v1.id } });
    expect(v1After.content).toEqual(v1.content);
    expect(v1After.status).toBe("SUPERSEDED");

    // A stale editor cannot overwrite v2, and v1 can no longer be approved.
    await expect(
      saveRequirementsVersion(engagement.id, client.id, { baseVersion: 1, content: draft.content! }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(approveRequirements(engagement.id, client.id, 1)).rejects.toBeInstanceOf(ConflictError);

    // AT-05: one approval leaves the baseline unapproved and the SOW blocked.
    const one = await approveRequirements(engagement.id, client.id, 2);
    expect(one.baselineApproved).toBe(false);
    await expect(getSowPreview(engagement.id, client.id)).rejects.toBeInstanceOf(ConflictError);
    // Approving twice is idempotent.
    await approveRequirements(engagement.id, client.id, 2);
    expect(await prisma.requirementsApproval.count({ where: { engagementId: engagement.id } })).toBe(1);

    // AT-06: the second party approves the same version.
    const both = await approveRequirements(engagement.id, freelancer.id, 2);
    expect(both.baselineApproved).toBe(true);
    expect(both.engagement.status).toBe("REQUIREMENTS_APPROVED");
    const v2 = await prisma.requirementsVersion.findFirstOrThrow({ where: { engagementId: engagement.id, versionNumber: 2 } });
    expect(v2.status).toBe("APPROVED");
    const { draft: sow } = await getSowPreview(engagement.id, client.id);
    expect(sow.requirementsVersionNumber).toBe(2);
    expect(await countRows("Agreement")).toBe(0);
  });

  it("revising an approved baseline resets approvals on the new version", async () => {
    const { client, freelancer, engagementId } = await engagementWithApprovedBaseline();
    const current = await prisma.requirementsVersion.findFirstOrThrow({ where: { engagementId, versionNumber: 1 } });
    await saveRequirementsVersion(engagementId, freelancer.id, {
      baseVersion: 1,
      content: current.content as unknown as RequirementsContent,
      changeSummary: "Tweak",
    });
    const engagement = await prisma.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    expect(engagement.status).toBe("REQUIREMENTS");
    expect(await prisma.requirementsApproval.count({ where: { engagementId, versionNumber: 2 } })).toBe(0);
    await expect(submitSow(engagementId, client.id, { revisionLimit: 3 })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("AT-07 / AT-08 — SOW and the agreement gate", () => {
  it("refuses to submit while a conflict is unresolved", async () => {
    // Proposal total 3000 is above a 2500 budget ceiling.
    const { client, engagementId } = await engagementWithApprovedBaseline({ budgetMax: 2500 });
    const { draft } = await getSowPreview(engagementId, client.id);
    expect(draft.conflicts.map((conflict) => conflict.id)).toEqual(["PRICE_OUTSIDE_BUDGET"]);

    await expect(submitSow(engagementId, client.id, { revisionLimit: 3 })).rejects.toBeInstanceOf(ValidationError);
    expect(await countRows("Agreement")).toBe(0);

    const { agreementId } = await submitSow(engagementId, client.id, {
      revisionLimit: 3,
      resolutions: { PRICE_OUTSIDE_BUDGET: "PROPOSAL_TOTAL" },
    });
    const version = await prisma.agreementVersion.findFirstOrThrow({ where: { agreementId } });
    const content = version.content as { sow: { conflictResolutions: Record<string, string> } };
    expect(content.sow.conflictResolutions).toEqual({ PRICE_OUTSIDE_BUDGET: "PROPOSAL_TOTAL" });
  });

  it("creates the agreement from the approved baseline, pending both approvals", async () => {
    const { client, freelancer, engagementId } = await engagementWithApprovedBaseline();
    const { agreementId, created } = await submitSow(engagementId, freelancer.id, { revisionLimit: 2 });
    expect(created).toBe(true);
    expect(await submitSow(engagementId, client.id, { revisionLimit: 2 })).toEqual({ agreementId, created: false });

    const agreement = await prisma.agreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(agreement.status).toBe("PENDING_APPROVAL");
    expect(agreement.revisionLimit).toBe(2);
    const version = await prisma.agreementVersion.findFirstOrThrow({ where: { agreementId } });
    const baseline = await prisma.requirementsVersion.findFirstOrThrow({ where: { engagementId, status: "APPROVED" } });
    expect(version.requirementsVersionId).toBe(baseline.id);
    const sow = (version.content as { sow: { deliverables: Array<{ requirementIds: string[] }> } }).sow;
    expect(sow.deliverables.every((deliverable) => deliverable.requirementIds.length > 0)).toBe(true);

    const engagement = await prisma.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    expect(engagement.status).toBe("AGREEMENT");
    expect(engagement.agreementId).toBe(agreementId);

    // AT-08: one approval is not enough; the same version from both activates it.
    expect((await approveVersion(agreementId, client.id)).status).toBe("PENDING_APPROVAL");
    expect((await approveVersion(agreementId, freelancer.id)).status).toBe("ACTIVE");

    // FR-07: a scope change is judged against the approved BRD + SOW, with evidence.
    const { changeRequest } = await submitChangeRequest(agreementId, client.id, {
      content: "Rework the pricing page layout",
    });
    const classified = await prisma.changeRequest.findUniqueOrThrow({ where: { id: changeRequest.id } });
    expect(classified.scopeBaseline).toBe("Requirements v1 + Agreement v1 (SOW)");
    const evidence = classified.scopeEvidence as Array<{ ref: string }>;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((entry) => /^(REQ|NFR|DEL|OOS)-\d{3}$/.test(entry.ref))).toBe(true);
  });
});

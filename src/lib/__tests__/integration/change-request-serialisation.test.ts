import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { submitChangeRequest } from "@/lib/change-requests";
import { ConflictError } from "@/lib/errors";
import { prisma, resetDatabase } from "../helpers/db";
import { createAgreementFixture } from "../helpers/fixtures";

/**
 * **Property 12: Change Request Serialisation**
 * **Validates: Requirements 12.8, 27.12**
 *
 * A single agreement carries at most one Change_Request in SUBMITTED status at a
 * time. The second submission — sequential or racing — must be rejected, and the
 * number of successful submissions always equals the number of open requests.
 */

const proposals = [
  "Please also build an events page and wire it into the navigation.",
  "We would like an extra blog section with a simple editor.",
  "Add a customer testimonials block to the homepage.",
  "Can you also set up analytics dashboards for the marketing team?",
];

beforeEach(async () => {
  await resetDatabase();
});

describe("Property 12 — change request serialisation", () => {
  it("leaves at most one SUBMITTED request per agreement", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...proposals), async (secondProposal) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({ agreementStatus: "ACTIVE" });

        const first = await submitChangeRequest(fixture.agreementId, fixture.client.id, {
          content: "Please also add a press page with downloadable assets.",
        });
        expect(first.changeRequest.status).toBe("SUBMITTED");

        const rejection = await submitChangeRequest(fixture.agreementId, fixture.freelancer.id, {
          content: secondProposal,
        }).catch((caught: unknown) => caught);

        expect(rejection).toBeInstanceOf(ConflictError);
        expect((rejection as ConflictError).status).toBe(409);
        expect((rejection as ConflictError).currentState).toBe("SUBMITTED");

        expect(
          await prisma.changeRequest.count({
            where: { agreementId: fixture.agreementId, status: "SUBMITTED" },
          }),
        ).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("holds the invariant when two parties submit at the same moment", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...proposals), async (secondProposal) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({ agreementStatus: "ACTIVE" });

        const outcomes = await Promise.allSettled([
          submitChangeRequest(fixture.agreementId, fixture.client.id, {
            content: "Please also add a press page with downloadable assets.",
          }),
          submitChangeRequest(fixture.agreementId, fixture.freelancer.id, {
            content: secondProposal,
          }),
        ]);

        const open = await prisma.changeRequest.count({
          where: { agreementId: fixture.agreementId, status: "SUBMITTED" },
        });
        const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled").length;

        expect(open).toBeLessThanOrEqual(1);
        expect(open).toBe(accepted);
      }),
      { numRuns: 100 },
    );
  });

  it("refuses a request against an agreement that is not active", async () => {
    const fixture = await createAgreementFixture({ agreementStatus: "PENDING_APPROVAL" });

    await expect(
      submitChangeRequest(fixture.agreementId, fixture.client.id, {
        content: "Please also add a press page.",
      }),
    ).rejects.toMatchObject({ status: 409, currentState: "PENDING_APPROVAL" });
  });

  it("records a scope label on the request that won the race", async () => {
    const fixture = await createAgreementFixture({ agreementStatus: "ACTIVE" });
    const created = await submitChangeRequest(fixture.agreementId, fixture.client.id, {
      content: "Please also add a press page with downloadable assets.",
    });

    const stored = await prisma.changeRequest.findUniqueOrThrow({
      where: { id: created.changeRequest.id },
    });
    expect(stored.scopeLabel).not.toBeNull();
    expect(["INCLUDED", "OUTSIDE_SCOPE", "AMBIGUOUS"]).toContain(stored.scopeLabel);
  });
});

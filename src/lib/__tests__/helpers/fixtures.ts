import { createHash } from "node:crypto";
import type {
  AgreementStatus,
  DeliverableStatus,
  MilestoneStatus,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStorageKey } from "@/lib/storage";

/**
 * Fixtures for the integration properties.
 *
 * They build the smallest graph that satisfies the real domain modules'
 * preconditions, so the properties drive production code paths instead of
 * re-implementations of them.
 */

export async function createUser(displayName: string, email: string) {
  return prisma.user.create({
    data: { displayName, email, passwordHash: "not-used-in-tests" },
  });
}

export interface PartyPair {
  client: Awaited<ReturnType<typeof createUser>>;
  freelancer: Awaited<ReturnType<typeof createUser>>;
  briefId: string;
  quotationId: string;
}

let sequence = 0;

/** One Client and one Freelancer with a brief and an accepted quotation. */
export async function createPartyPair(): Promise<PartyPair> {
  sequence += 1;
  const client = await createUser(`Client ${sequence}`, `client-${sequence}@example.test`);
  const freelancer = await createUser(`Freelancer ${sequence}`, `freelancer-${sequence}@example.test`);

  const brief = await prisma.brief.create({
    data: {
      clientId: client.id,
      title: `Brief ${sequence}`,
      description: "Design and build a responsive marketing site with a design system.",
      deliverables: ["Homepage", "Design system"] as object,
      budgetMin: 2000,
      budgetMax: 6000,
      targetDate: new Date("2026-06-01T00:00:00.000Z"),
      status: "OPEN",
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  const quotation = await prisma.quotation.create({
    data: {
      briefId: brief.id,
      freelancerId: freelancer.id,
      status: "ACCEPTED",
      lineItems: [{ description: "Marketing site", quantity: 1, unitPrice: 4000 }] as object,
      timelineDays: 21,
      notes: "Two milestones.",
      submittedAt: new Date("2026-01-05T00:00:00.000Z"),
    },
  });

  return { client, freelancer, briefId: brief.id, quotationId: quotation.id };
}

export interface AgreementFixtureOptions {
  agreementStatus?: AgreementStatus;
  /** One milestone per entry; defaults to a single PENDING milestone. */
  milestones?: Array<{ status?: MilestoneStatus; paymentStatus?: PaymentStatus | null }>;
}

export interface AgreementFixture extends PartyPair {
  agreementId: string;
  versionId: string;
  versionNumber: number;
  milestoneIds: string[];
  paymentIds: string[];
}

/**
 * An Agreement with one version and a configurable set of milestones, each
 * optionally backed by a Payment in a chosen status.
 */
export async function createAgreementFixture(
  options: AgreementFixtureOptions = {},
): Promise<AgreementFixture> {
  const pair = await createPartyPair();
  const { client, freelancer } = pair;

  const agreement = await prisma.agreement.create({
    data: {
      briefId: pair.briefId,
      quotationId: pair.quotationId,
      clientId: client.id,
      freelancerId: freelancer.id,
      status: options.agreementStatus ?? "ACTIVE",
      currentVersion: 1,
      startDate: new Date("2026-01-10T00:00:00.000Z"),
      currency: "USD",
    },
  });

  const version = await prisma.agreementVersion.create({
    data: {
      agreementId: agreement.id,
      versionNumber: 1,
      authorId: client.id,
      authorRole: "CLIENT",
      content: {
        scope: "Design and build a responsive marketing site with a design system.",
        totalAmount: 4000,
        currency: "USD",
      } as object,
    },
  });

  const milestoneSpecs = options.milestones ?? [{ status: "PENDING" as MilestoneStatus }];
  const milestoneIds: string[] = [];
  const paymentIds: string[] = [];

  for (const [index, spec] of milestoneSpecs.entries()) {
    const milestone = await prisma.milestone.create({
      data: {
        agreementId: agreement.id,
        agreementVersionId: version.id,
        name: `Milestone ${index + 1}`,
        description: `Deliverable set ${index + 1}`,
        dueDate: new Date(`2026-03-0${(index % 9) + 1}T00:00:00.000Z`),
        paymentAmount: 2000,
        status: spec.status ?? "PENDING",
      },
    });
    milestoneIds.push(milestone.id);

    if (spec.paymentStatus) {
      const payment = await prisma.payment.create({
        data: {
          milestoneId: milestone.id,
          agreementVersionId: version.id,
          clientId: client.id,
          status: spec.paymentStatus,
          amountExpected: 2000,
          amountCaptured: spec.paymentStatus === "CAPTURED" ? 2000 : null,
          capturedAt: spec.paymentStatus === "CAPTURED" ? new Date() : null,
          currency: "USD",
          // Deterministic per milestone so a webhook payload can target it.
          paypalOrderId: `ORDER-${milestone.id}`,
          idempotencyKey: `idem-${milestone.id}`,
        },
      });
      paymentIds.push(payment.id);
    }
  }

  return {
    ...pair,
    agreementId: agreement.id,
    versionId: version.id,
    versionNumber: 1,
    milestoneIds,
    paymentIds,
  };
}

export interface DeliverableFixture extends AgreementFixture {
  deliverableId: string;
  originalKey: string;
  originalHash: string;
}

/**
 * Adds a Deliverable row whose stored hash matches the bytes that will be
 * written to storage, so the integrity check behaves the way it does in
 * production.
 */
export async function createDeliverableFixture(
  options: AgreementFixtureOptions & {
    deliverableStatus?: DeliverableStatus;
    body?: Buffer;
  } = {},
): Promise<DeliverableFixture> {
  const fixture = await createAgreementFixture(options);
  const body = options.body ?? Buffer.from("%PDF-1.7 property test deliverable\n");
  const freelancerId = fixture.freelancer.id;

  const deliverable = await prisma.deliverable.create({
    data: {
      milestoneId: fixture.milestoneIds[0],
      freelancerId,
      status: options.deliverableStatus ?? "APPROVED",
      originalKey: generateStorageKey(),
      previewKey: generateStorageKey(),
      originalHash: createHash("sha256").update(body).digest("hex"),
      previewHash: createHash("sha256").update(body).digest("hex"),
      fileName: "deliverable.pdf",
      fileSizeBytes: body.byteLength,
    },
  });

  return {
    ...fixture,
    deliverableId: deliverable.id,
    originalKey: deliverable.originalKey,
    originalHash: deliverable.originalHash,
  };
}

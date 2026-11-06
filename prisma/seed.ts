/**
 * PactFlow demo seed.
 *
 * Builds one coherent story so every screen has something to show:
 *
 *  1. An OPEN brief with two submitted quotations and a comparison workspace.
 *  2. An ACTIVE agreement covering three milestones — one paid and approved,
 *     one delivered and awaiting review, and one still pending an upload —
 *     plus the deliverables behind each on disk.
 *  3. A COMPLETED project that produced a collaboration history, two working
 *     preferences, a cited summary and a reusable template.
 *
 * Run with `npm run db:seed` (idempotent — it clears the demo tables first).
 */
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Password123!";
const STORAGE_DIR = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || ".data/storage");
/** Where the mock checkout lives, so a seeded order's approve link is absolute. */
const APP_URL = process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3000";

const CLIENT_EMAIL = "client@pactflow.dev";
const FREELANCER_EMAIL = "freelancer@pactflow.dev";
const SECOND_FREELANCER_EMAIL = "grace@pactflow.dev";

const day = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * day);

/** Child-first so SQLite's foreign keys never block the reset. */
const TABLES = [
  "ComparisonAnnotation",
  "ComparisonItem",
  "ComparisonWorkspace",
  "SignedUrlEvent",
  "RevisionRequest",
  "Payment",
  "Deliverable",
  "Milestone",
  "WorkingPreference",
  "CollaborationSummary",
  "ProjectTemplate",
  "CollaborationHistory",
  "ChangeRequestVote",
  "ScopeLabelDispute",
  "ChangeRequest",
  "DiscussionMessage",
  "AgreementApproval",
  "AgreementVersion",
  "Agreement",
  "QuotationComment",
  "Quotation",
  "Invitation",
  "Brief",
  "AuditLog",
  "Notification",
  "WebhookEvent",
  "Session",
  "LoginAttempt",
  "ProjectTemplate",
  "User",
];

async function clearDemoData() {
  const unique = [...new Set(TABLES)];
  for (const table of unique) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
}

function storageKey(): string {
  return `obj_${randomUUID()}`;
}

async function storeObject(key: string, body: Buffer): Promise<string> {
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(path.join(STORAGE_DIR, key), body);
  return createHash("sha256").update(body).digest("hex");
}

async function renderPdf(title: string, lines: string[], watermark: boolean): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText(title, { x: 56, y: 770, size: 20, font: bold, color: rgb(0.09, 0.11, 0.18) });
  page.drawText("PactFlow demo deliverable", {
    x: 56,
    y: 748,
    size: 10,
    font,
    color: rgb(0.4, 0.45, 0.55),
  });
  page.drawLine({
    start: { x: 56, y: 736 },
    end: { x: 539, y: 736 },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.91),
  });

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 56,
      y: 706 - index * 20,
      size: 11,
      font,
      color: rgb(0.15, 0.18, 0.25),
    });
  });

  if (watermark) {
    page.drawText("PREVIEW", {
      x: 120,
      y: 300,
      size: 96,
      font: bold,
      color: rgb(0.75, 0.78, 0.85),
      opacity: 0.3,
      rotate: degrees(35),
    });
  }

  return Buffer.from(await pdf.save());
}

async function createUser(email: string, displayName: string, passwordHash: string) {
  return prisma.user.create({ data: { email, displayName, passwordHash } });
}

async function main() {
  console.log("Clearing demo data…");
  await clearDemoData();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const client = await createUser(CLIENT_EMAIL, "Northwind Studio", passwordHash);
  const freelancer = await createUser(FREELANCER_EMAIL, "Ada Lovelace", passwordHash);
  const secondFreelancer = await createUser(SECOND_FREELANCER_EMAIL, "Grace Hopper", passwordHash);

  // ── Scenario 1: an open brief with two quotations in comparison ────────────
  console.log("Seeding the open brief and its quotations…");
  const brief = await prisma.brief.create({
    data: {
      clientId: client.id,
      title: "Marketing site rebuild",
      description:
        "Rebuild our marketing site in Next.js with a reusable design system, a pricing page " +
        "and an accessible navigation. Copy and brand assets are ready.",
      deliverables: ["Homepage", "Pricing page", "Design system"] as object,
      budgetMin: 4000,
      budgetMax: 6500,
      targetDate: at(45),
      status: "OPEN",
      publishedAt: at(-6),
    },
  });

  await prisma.invitation.createMany({
    data: [
      { briefId: brief.id, clientId: client.id, freelancerId: freelancer.id, status: "ACCEPTED" },
      {
        briefId: brief.id,
        clientId: client.id,
        freelancerId: secondFreelancer.id,
        status: "ACCEPTED",
      },
    ],
  });

  const adaQuotation = await prisma.quotation.create({
    data: {
      briefId: brief.id,
      freelancerId: freelancer.id,
      status: "SUBMITTED",
      lineItems: [
        { description: "Discovery and IA", quantity: 1, unitPrice: 900 },
        { description: "Design system", quantity: 1, unitPrice: 2100 },
        { description: "Homepage and pricing build", quantity: 1, unitPrice: 1800 },
      ] as object,
      timelineDays: 21,
      notes: "Two review rounds included. Content migrations are quoted separately.",
      submittedAt: at(-4),
    },
  });

  const graceQuotation = await prisma.quotation.create({
    data: {
      briefId: brief.id,
      freelancerId: secondFreelancer.id,
      status: "SUBMITTED",
      lineItems: [
        { description: "Full rebuild in one sprint", quantity: 1, unitPrice: 3300 },
        { description: "Accessibility audit", quantity: 1, unitPrice: 600 },
      ] as object,
      timelineDays: 30,
      notes: "Single fixed-price sprint. Includes a written accessibility report.",
      submittedAt: at(-3),
    },
  });

  const workspace = await prisma.comparisonWorkspace.create({
    data: {
      briefId: brief.id,
      clientId: client.id,
      selections: [adaQuotation.id, graceQuotation.id] as object,
    },
  });

  await prisma.comparisonItem.createMany({
    data: [
      { workspaceId: workspace.id, quotationId: adaQuotation.id },
      { workspaceId: workspace.id, quotationId: graceQuotation.id },
    ],
  });

  // ── Scenario 2: an active agreement, part paid ─────────────────────────────
  console.log("Seeding the active agreement…");
  const agreement = await prisma.agreement.create({
    data: {
      briefId: brief.id,
      quotationId: adaQuotation.id,
      clientId: client.id,
      freelancerId: freelancer.id,
      status: "ACTIVE",
      currentVersion: 1,
      startDate: at(-5),
      currency: "USD",
    },
  });

  const versionOne = await prisma.agreementVersion.create({
    data: {
      agreementId: agreement.id,
      versionNumber: 1,
      authorId: client.id,
      authorRole: "CLIENT",
      content: {
        description: brief.description,
        scope:
          "Discovery and information architecture, a design system, and the homepage and " +
          "pricing pages built on it.",
        deliverables: ["Homepage", "Pricing page", "Design system"],
        lineItems: adaQuotation.lineItems,
        timelineDays: 21,
        totalAmount: 4800,
        currency: "USD",
        budgetMin: 4000,
        budgetMax: 6500,
        milestones: [
          { name: "Design system and homepage", amount: 1600 },
          { name: "Pricing page", amount: 1600 },
          { name: "Final QA and handover", amount: 1600 },
        ],
      } as object,
    },
  });

  await prisma.agreementApproval.createMany({
    data: [
      {
        agreementId: agreement.id,
        versionId: versionOne.id,
        versionNumber: 1,
        actorId: client.id,
        actorRole: "CLIENT",
        state: "APPROVED",
        approvedAt: at(-5),
      },
      {
        agreementId: agreement.id,
        versionId: versionOne.id,
        versionNumber: 1,
        actorId: freelancer.id,
        actorRole: "FREELANCER",
        state: "APPROVED",
        approvedAt: at(-5),
      },
    ],
  });

  const paidMilestone = await prisma.milestone.create({
    data: {
      agreementId: agreement.id,
      agreementVersionId: versionOne.id,
      name: "Design system and homepage",
      description: "Component library, tokens and the homepage built on top of them.",
      dueDate: at(-1),
      paymentAmount: 1600,
      status: "APPROVED",
      deliveredAt: at(-3),
      approvedAt: at(-2),
    },
  });

  const reviewedMilestone = await prisma.milestone.create({
    data: {
      agreementId: agreement.id,
      agreementVersionId: versionOne.id,
      name: "Pricing page",
      description: "Pricing page, responsive states and a recorded handover session.",
      dueDate: at(10),
      paymentAmount: 1600,
      status: "DELIVERED",
      deliveredAt: at(-1),
    },
  });

  // Left untouched on purpose: the Freelancer still has to upload against it, so
  // the Delivery Room demonstrates the upload → preview → approve path as well.
  await prisma.milestone.create({
    data: {
      agreementId: agreement.id,
      agreementVersionId: versionOne.id,
      name: "Final QA and handover",
      description: "Cross-browser QA pass and the recorded handover session.",
      dueDate: at(21),
      paymentAmount: 1600,
      status: "PENDING",
    },
  });

  const paidOriginal = await renderPdf(
    "Design system — v1",
    ["Tokens: colour, spacing, type scale.", "Components: button, input, card, nav.", "Homepage composed from the library."],
    false,
  );
  const paidPreview = await renderPdf(
    "Design system — v1",
    ["Tokens: colour, spacing, type scale.", "Components: button, input, card, nav.", "Homepage composed from the library."],
    true,
  );
  const paidOriginalKey = storageKey();
  const paidPreviewKey = storageKey();
  const paidOriginalHash = await storeObject(paidOriginalKey, paidOriginal);
  const paidPreviewHash = await storeObject(paidPreviewKey, paidPreview);

  const paidDeliverable = await prisma.deliverable.create({
    data: {
      milestoneId: paidMilestone.id,
      freelancerId: freelancer.id,
      versionNumber: 1,
      status: "APPROVED",
      originalKey: paidOriginalKey,
      previewKey: paidPreviewKey,
      originalHash: paidOriginalHash,
      previewHash: paidPreviewHash,
      fileName: "design-system-v1.pdf",
      fileSizeBytes: paidOriginal.byteLength,
      uploadedAt: at(-3),
    },
  });

  await prisma.payment.create({
    data: {
      milestoneId: paidMilestone.id,
      deliverableId: paidDeliverable.id,
      agreementVersionId: versionOne.id,
      clientId: client.id,
      status: "CAPTURED",
      amountExpected: 1600,
      amountCaptured: 1600,
      currency: "USD",
      paypalOrderId: `MOCK-DEMO-${paidMilestone.id.slice(-8).toUpperCase()}`,
      paypalStatus: "COMPLETED",
      idempotencyKey: `idem-${paidMilestone.id}`,
      capturedAt: at(-2),
      captureResponse: { status: "COMPLETED", _mock: true } as object,
    },
  });

  const reviewOriginal = await renderPdf(
    "Pricing page — v1",
    ["Three plan columns with annual toggle.", "Comparison table below the fold.", "Handover notes attached to the delivery room."],
    false,
  );
  const reviewPreview = await renderPdf(
    "Pricing page — v1",
    ["Three plan columns with annual toggle.", "Comparison table below the fold.", "Handover notes attached to the delivery room."],
    true,
  );
  const reviewOriginalKey = storageKey();
  const reviewPreviewKey = storageKey();
  const reviewOriginalHash = await storeObject(reviewOriginalKey, reviewOriginal);
  const reviewPreviewHash = await storeObject(reviewPreviewKey, reviewPreview);

  const reviewDeliverable = await prisma.deliverable.create({
    data: {
      milestoneId: reviewedMilestone.id,
      freelancerId: freelancer.id,
      versionNumber: 1,
      status: "UPLOADED",
      originalKey: reviewOriginalKey,
      previewKey: reviewPreviewKey,
      originalHash: reviewOriginalHash,
      previewHash: reviewPreviewHash,
      fileName: "pricing-page-v1.pdf",
      fileSizeBytes: reviewOriginal.byteLength,
      uploadedAt: at(-1),
    },
  });

  // The other half of the payment lifecycle: an order that was opened and never
  // captured. The token is the stored order id, which is exactly what the mock
  // checkout posts back to /api/payments/capture, so continuing this payment
  // resumes the same attempt instead of inventing a second one.
  const reviewOrderId = `MOCK-REVIEW-${reviewedMilestone.id.slice(-8).toUpperCase()}`;
  await prisma.payment.create({
    data: {
      milestoneId: reviewedMilestone.id,
      deliverableId: reviewDeliverable.id,
      agreementVersionId: versionOne.id,
      clientId: client.id,
      status: "PENDING",
      amountExpected: 1600,
      currency: "USD",
      paypalOrderId: reviewOrderId,
      paypalStatus: "CREATED",
      approveUrl: `${APP_URL}/payments/mock-approve?token=${reviewOrderId}`,
      idempotencyKey: `idem-review-${reviewedMilestone.id}`,
    },
  });

  await prisma.discussionMessage.createMany({
    data: [
      {
        agreementId: agreement.id,
        authorId: client.id,
        content: "Kicking off — brand tokens land in Figma this week. Anything you need from us?",
        createdAt: at(-5),
      },
      {
        agreementId: agreement.id,
        authorId: freelancer.id,
        content: "All set. I will share the component library for review before the homepage build.",
        createdAt: at(-4),
      },
    ],
  });

  // ── Scenario 3: a completed project that feeds relationship intelligence ───
  console.log("Seeding the completed project and its collaboration history…");
  const pastBrief = await prisma.brief.create({
    data: {
      clientId: client.id,
      title: "Product launch landing page",
      description:
        "A single high-conversion launch page with an email capture flow and a " +
        "press-kit download.",
      deliverables: ["Launch page", "Press kit"] as object,
      budgetMin: 2500,
      budgetMax: 3500,
      targetDate: at(-40),
      status: "CLOSED",
      publishedAt: at(-70),
    },
  });

  const pastQuotation = await prisma.quotation.create({
    data: {
      briefId: pastBrief.id,
      freelancerId: freelancer.id,
      status: "ACCEPTED",
      lineItems: [
        { description: "Launch page", quantity: 1, unitPrice: 2400 },
        { description: "Press kit", quantity: 1, unitPrice: 600 },
      ] as object,
      timelineDays: 14,
      notes: "Two revision rounds included.",
      submittedAt: at(-66),
    },
  });

  const pastAgreement = await prisma.agreement.create({
    data: {
      briefId: pastBrief.id,
      quotationId: pastQuotation.id,
      clientId: client.id,
      freelancerId: freelancer.id,
      status: "COMPLETED",
      currentVersion: 1,
      startDate: at(-62),
      completedAt: at(-32),
      currency: "USD",
    },
  });

  const pastVersion = await prisma.agreementVersion.create({
    data: {
      agreementId: pastAgreement.id,
      versionNumber: 1,
      authorId: client.id,
      authorRole: "CLIENT",
      content: {
        description: pastBrief.description,
        scope: "A single launch page plus a press kit.",
        deliverables: ["Launch page", "Press kit"],
        lineItems: pastQuotation.lineItems,
        timelineDays: 14,
        totalAmount: 3000,
        currency: "USD",
        budgetMin: 2500,
        budgetMax: 3500,
      } as object,
      createdAt: at(-62),
    },
  });

  await prisma.agreementApproval.createMany({
    data: [
      {
        agreementId: pastAgreement.id,
        versionId: pastVersion.id,
        versionNumber: 1,
        actorId: client.id,
        actorRole: "CLIENT",
        state: "APPROVED",
        approvedAt: at(-62),
      },
      {
        agreementId: pastAgreement.id,
        versionId: pastVersion.id,
        versionNumber: 1,
        actorId: freelancer.id,
        actorRole: "FREELANCER",
        state: "APPROVED",
        approvedAt: at(-62),
      },
    ],
  });

  const pastMilestone = await prisma.milestone.create({
    data: {
      agreementId: pastAgreement.id,
      agreementVersionId: pastVersion.id,
      name: "Launch page and press kit",
      description: "Launch page built and shipped, press kit packaged.",
      dueDate: at(-34),
      paymentAmount: 3000,
      status: "APPROVED",
      deliveredAt: at(-35),
      approvedAt: at(-34),
    },
  });

  const pastOriginal = await renderPdf(
    "Launch page and press kit",
    ["Launch page shipped.", "Press kit assets packaged.", "Final approved version."],
    false,
  );
  const pastPreview = await renderPdf(
    "Launch page and press kit",
    ["Launch page shipped.", "Press kit assets packaged.", "Final approved version."],
    true,
  );
  const pastOriginalKey = storageKey();
  const pastPreviewKey = storageKey();
  const pastOriginalHash = await storeObject(pastOriginalKey, pastOriginal);
  const pastPreviewHash = await storeObject(pastPreviewKey, pastPreview);

  const pastDeliverable = await prisma.deliverable.create({
    data: {
      milestoneId: pastMilestone.id,
      freelancerId: freelancer.id,
      versionNumber: 1,
      status: "APPROVED",
      originalKey: pastOriginalKey,
      previewKey: pastPreviewKey,
      originalHash: pastOriginalHash,
      previewHash: pastPreviewHash,
      fileName: "launch-page-press-kit.pdf",
      fileSizeBytes: pastOriginal.byteLength,
      uploadedAt: at(-35),
    },
  });

  const pastPayment = await prisma.payment.create({
    data: {
      milestoneId: pastMilestone.id,
      deliverableId: pastDeliverable.id,
      agreementVersionId: pastVersion.id,
      clientId: client.id,
      status: "CAPTURED",
      amountExpected: 3000,
      amountCaptured: 3000,
      currency: "USD",
      paypalOrderId: `MOCK-DEMO-${pastMilestone.id.slice(-8).toUpperCase()}`,
      paypalStatus: "COMPLETED",
      idempotencyKey: `idem-${pastMilestone.id}`,
      capturedAt: at(-33),
      captureResponse: { status: "COMPLETED", _mock: true } as object,
    },
  });

  const history = await prisma.collaborationHistory.create({
    data: {
      clientId: client.id,
      freelancerId: freelancer.id,
      agreementId: pastAgreement.id,
      agreementSnapshot: {
        agreementId: pastAgreement.id,
        briefId: pastBrief.id,
        briefTitle: pastBrief.title,
        quotationId: pastQuotation.id,
        versionNumber: 1,
        content: pastVersion.content,
        startDate: pastAgreement.startDate?.toISOString() ?? null,
        completedAt: at(-32).toISOString(),
        milestoneCount: 1,
        currency: "USD",
      } as object,
      deliverables: [
        {
          id: pastDeliverable.id,
          milestoneId: pastMilestone.id,
          milestoneName: pastMilestone.name,
          fileName: pastDeliverable.fileName,
          versionNumber: pastDeliverable.versionNumber,
          uploadedAt: pastDeliverable.uploadedAt.toISOString(),
        },
      ] as object,
      completedAt: at(-32),
      totalPaymentAmount: Number(pastPayment.amountCaptured ?? 0),
    },
  });

  const confirmedPreference = await prisma.workingPreference.create({
    data: {
      historyId: history.id,
      authorId: client.id,
      statement: "Sends a short written summary after every review call so decisions are on record.",
      status: "CONFIRMED",
      acknowledgedBy: freelancer.id,
      acknowledgedAt: at(-30),
      createdAt: at(-31),
    },
  });

  await prisma.workingPreference.create({
    data: {
      historyId: history.id,
      authorId: freelancer.id,
      statement: "Shares annotated drafts at least 24 hours before a review call.",
      status: "PENDING_ACKNOWLEDGEMENT",
      createdAt: at(-29),
    },
  });

  await prisma.collaborationSummary.create({
    data: {
      historyId: history.id,
      requestorId: client.id,
      content: {
        summary:
          "Northwind Studio and Ada Lovelace completed one project together: the product " +
          "launch landing page, delivered in a single milestone and paid in full at $3,000.00. " +
          "One working preference has been mutually confirmed so far. This summary is limited " +
          "to the records cited below.",
        statements: [
          {
            text: "Product launch landing page was completed and paid in full at $3,000.00.",
            sourceType: "AGREEMENT",
            sourceId: pastAgreement.id,
          },
          {
            text: "launch-page-press-kit.pdf was the approved deliverable for that project.",
            sourceType: "DELIVERABLE",
            sourceId: pastAgreement.id,
          },
          {
            text: "The Client and the Freelancer both confirmed that written summaries follow every review call.",
            sourceType: "WORKING_PREFERENCE",
            sourceId: confirmedPreference.id,
          },
        ],
      } as object,
      generatedAt: at(-28),
      flaggedStatements: [] as object,
    },
  });

  await prisma.projectTemplate.create({
    data: {
      historyId: history.id,
      clientId: client.id,
      name: "Launch page engagement",
      templateData: {
        briefTitle: "Product launch landing page",
        description:
          "A single high-conversion launch page with an email capture flow and a press-kit download.",
        deliverables: ["Launch page", "Press kit"],
        lineItems: pastQuotation.lineItems,
        timelineDays: 14,
        budgetMin: 2500,
        budgetMax: 3500,
        milestoneCount: 1,
        currency: "USD",
      } as object,
    },
  });

  // ── A short audit trail so the operator view is not empty ─────────────────
  const auditSeed: Array<{
    eventType: string;
    actorId: string;
    resourceId: string;
    resourceType: string;
    previousState: string | null;
    newState: string;
  }> = [
    {
      eventType: "USER_REGISTERED",
      actorId: client.id,
      resourceId: client.id,
      resourceType: "User",
      previousState: null,
      newState: "REGISTERED",
    },
    {
      eventType: "BRIEF_PUBLISHED",
      actorId: client.id,
      resourceId: brief.id,
      resourceType: "Brief",
      previousState: "DRAFT",
      newState: "OPEN",
    },
    {
      eventType: "QUOTATION_SUBMITTED",
      actorId: freelancer.id,
      resourceId: adaQuotation.id,
      resourceType: "Quotation",
      previousState: "DRAFT",
      newState: "SUBMITTED",
    },
    {
      eventType: "AGREEMENT_ACTIVATED",
      actorId: client.id,
      resourceId: agreement.id,
      resourceType: "Agreement",
      previousState: "PENDING_APPROVAL",
      newState: "ACTIVE",
    },
    {
      eventType: "PAYMENT_CAPTURED",
      actorId: client.id,
      resourceId: paidMilestone.id,
      resourceType: "Milestone",
      previousState: "PENDING",
      newState: "CAPTURED",
    },
    {
      eventType: "COLLABORATION_HISTORY_CREATED",
      actorId: client.id,
      resourceId: history.id,
      resourceType: "CollaborationHistory",
      previousState: null,
      newState: "COMPLETED",
    },
  ];

  for (const [index, entry] of auditSeed.entries()) {
    await prisma.auditLog.create({
      data: { ...entry, createdAt: new Date(Date.now() - (auditSeed.length - index) * 3_600_000) },
    });
  }

  console.log("\nDemo data ready.");
  console.log(`  Client      ${CLIENT_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Freelancer  ${FREELANCER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Freelancer  ${SECOND_FREELANCER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Brief       /briefs/${brief.id}  (open, two quotations)`);
  console.log(`  Agreement   /agreements/${agreement.id}  (active, one of three milestones paid)`);
  console.log(`  History     /collaboration/${client.id}/${freelancer.id}`);
  console.log(`  Summary     /collaboration/history/${history.id}/summary`);
  console.log(`  Templates   /collaboration/history/${history.id}/templates`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

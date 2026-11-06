import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ComparisonWorkspace, Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { assertBriefOwner, recordAccessViolation } from "@/lib/access";
import { asRecordArray, asStringArray } from "@/lib/serializers";
import { quotationTotal } from "@/lib/quotations";
import { generateComparisonSummary, AI_COMPARISON_UNAVAILABLE } from "@/lib/ai/comparison";
import type { ComparisonSummary } from "@/lib/ai/schemas";
import { formatUsd } from "@/lib/ai/heuristic";
import { createAgreementFromQuotation } from "@/lib/agreements";

/**
 * Requirement 8 — Quotation Comparison Workspace.
 *
 * Selection state and private annotations live in the database keyed by Brief,
 * so they survive browser sessions (Requirement 8.9). Annotations are scoped to
 * the owning Client and are never returned to Freelancers (Requirement 8.7).
 */

export const ANNOTATION_MIN_LENGTH = 1;
export const ANNOTATION_MAX_LENGTH = 500;
export const COMPARABLE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED"] as const;

export interface ComparisonColumn {
  quotationId: string;
  freelancerId: string;
  freelancerName: string;
  status: string;
  total: number;
  timelineDays: number;
  submittedAt: Date | null;
  notes: string;
  lineItems: Array<{ description: string; price: number; pricingConfidence?: string }>;
}

export interface AnnotationView {
  quotationId: string;
  attribute: string;
  noteText: string;
  updatedAt: Date;
}

export interface ComparisonWorkspaceState {
  workspaceId: string | null;
  briefId: string;
  briefTitle: string;
  /** Requirement 8.1 — at least two quotations in a comparable status. */
  available: boolean;
  /** Requirement 8.11 — false when only one quotation exists. */
  multiColumn: boolean;
  selections: string[];
  columns: ComparisonColumn[];
  /** Quotations that may be added to the comparison. */
  addable: Array<{ quotationId: string; freelancerName: string; total: number }>;
  annotations: AnnotationView[];
  aiSummary: ComparisonSummary | null;
  aiSummaryGeneratedAt: string | null;
  aiSummaryNotice: string | null;
  exportedAt: Date | null;
}

function readSelections(workspace: ComparisonWorkspace | null): string[] {
  if (!workspace) return [];
  return asStringArray(workspace.selections);
}

function toColumn(quotation: Quotation & { freelancer: { displayName: string } }): ComparisonColumn {
  const lineItems = asRecordArray(quotation.lineItems).map((item) => ({
    description: typeof item.description === "string" ? item.description : "",
    price: typeof item.price === "number" ? item.price : 0,
    pricingConfidence: typeof item.pricingConfidence === "string" ? item.pricingConfidence : undefined,
  }));
  return {
    quotationId: quotation.id,
    freelancerId: quotation.freelancerId,
    freelancerName: quotation.freelancer.displayName,
    status: quotation.status,
    total: quotationTotal(quotation.lineItems),
    timelineDays: quotation.timelineDays,
    submittedAt: quotation.submittedAt,
    notes: quotation.notes,
    lineItems,
  };
}

async function loadBriefForClient(briefId: string, clientId: string) {
  return assertBriefOwner(briefId, clientId);
}

async function ensureWorkspace(briefId: string, clientId: string): Promise<ComparisonWorkspace> {
  const existing = await prisma.comparisonWorkspace.findUnique({ where: { briefId } });
  if (existing) return existing;
  return prisma.comparisonWorkspace.create({
    data: { briefId, clientId, selections: [] as unknown as object },
  });
}

/**
 * Requirement 8.1/8.2/8.9/8.11 — full read model for the workspace page.
 */
export async function openWorkspace(
  briefId: string,
  clientId: string,
): Promise<ComparisonWorkspaceState> {
  const brief = await loadBriefForClient(briefId, clientId);
  const workspace = await prisma.comparisonWorkspace.findUnique({
    where: { briefId },
    include: { annotations: { orderBy: { updatedAt: "desc" } } },
  });

  const comparable = await prisma.quotation.findMany({
    where: { briefId, status: { in: [...COMPARABLE_STATUSES] } },
    include: { freelancer: { select: { id: true, displayName: true } } },
    orderBy: { submittedAt: "asc" },
  });

  const selections = readSelections(workspace).filter((id) =>
    comparable.some((quotation) => quotation.id === id),
  );
  const selected = selections
    .map((id) => comparable.find((quotation) => quotation.id === id))
    .filter((quotation): quotation is (typeof comparable)[number] => Boolean(quotation));

  const totalComparable = comparable.length;
  const aiSummaryRaw = workspace?.aiSummary as unknown;
  const aiSummary =
    aiSummaryRaw && typeof aiSummaryRaw === "object" && "summary" in (aiSummaryRaw as object)
      ? (aiSummaryRaw as ComparisonSummary)
      : null;

  return {
    workspaceId: workspace?.id ?? null,
    briefId,
    briefTitle: brief.title,
    available: totalComparable >= 2,
    multiColumn: totalComparable > 1,
    selections,
    columns: selected.map(toColumn),
    addable: comparable
      .filter((quotation) => !selections.includes(quotation.id))
      .map((quotation) => ({
        quotationId: quotation.id,
        freelancerName: quotation.freelancer.displayName,
        total: quotationTotal(quotation.lineItems),
      })),
    annotations: (workspace?.annotations ?? []).map((annotation) => ({
      quotationId: annotation.quotationId,
      attribute: annotation.attribute,
      noteText: annotation.noteText,
      updatedAt: annotation.updatedAt,
    })),
    aiSummary,
    aiSummaryGeneratedAt: workspace?.updatedAt && aiSummary ? workspace.updatedAt.toISOString() : null,
    aiSummaryNotice: null,
    exportedAt: workspace?.exportedAt ?? null,
  };
}

async function assertComparableQuotation(quotationId: string, briefId: string): Promise<void> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation || quotation.briefId !== briefId) throw new NotFoundError("Quotation");
  if (!(COMPARABLE_STATUSES as readonly string[]).includes(quotation.status)) {
    throw new ConflictError(
      "QUOTATION_NOT_COMPARABLE",
      "Only submitted or shortlisted quotations can be compared.",
      quotation.status,
    );
  }
}

/**
 * Requirement 8.3/8.9 — add a Quotation without leaving the workspace.
 */
export async function addToComparison(
  briefId: string,
  clientId: string,
  quotationId: string,
): Promise<ComparisonWorkspaceState> {
  await loadBriefForClient(briefId, clientId);
  await assertComparableQuotation(quotationId, briefId);
  const workspace = await ensureWorkspace(briefId, clientId);
  const selections = readSelections(workspace);

  if (selections.includes(quotationId)) {
    return openWorkspace(briefId, clientId);
  }

  const next = [...selections, quotationId];

  await withTransaction(async (tx) => {
    await tx.comparisonWorkspace.update({
      where: { id: workspace.id },
      data: { selections: next as unknown as object },
    });
    await tx.comparisonItem.upsert({
      where: { workspaceId_quotationId: { workspaceId: workspace.id, quotationId } },
      create: { workspaceId: workspace.id, quotationId },
      update: {},
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_SHORTLISTED",
      actorId: clientId,
      resourceId: workspace.id,
      resourceType: "ComparisonWorkspace",
      previousState: String(selections.length),
      newState: String(next.length),
      metadata: { action: "ADD", briefId, quotationId },
    });
  });

  return openWorkspace(briefId, clientId);
}

/**
 * Requirement 8.3/8.9 — remove a Quotation, keeping annotations for the Client.
 */
export async function removeFromComparison(
  briefId: string,
  clientId: string,
  quotationId: string,
): Promise<ComparisonWorkspaceState> {
  await loadBriefForClient(briefId, clientId);
  const workspace = await prisma.comparisonWorkspace.findUnique({ where: { briefId } });
  if (!workspace) return openWorkspace(briefId, clientId);

  const selections = readSelections(workspace);
  const next = selections.filter((id) => id !== quotationId);

  await withTransaction(async (tx) => {
    await tx.comparisonWorkspace.update({
      where: { id: workspace.id },
      data: { selections: next as unknown as object },
    });
    await tx.comparisonItem.deleteMany({ where: { workspaceId: workspace.id, quotationId } });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_UPDATED",
      actorId: clientId,
      resourceId: workspace.id,
      resourceType: "ComparisonWorkspace",
      previousState: String(selections.length),
      newState: String(next.length),
      metadata: { action: "REMOVE", briefId, quotationId },
    });
  });

  return openWorkspace(briefId, clientId);
}

/**
 * Requirement 8.4–8.6 — AI comparison with a 30-second budget. On failure the
 * columns stay rendered and the notice explains that the comparison is manual.
 */
export async function requestAIComparison(
  briefId: string,
  clientId: string,
): Promise<ComparisonWorkspaceState> {
  await loadBriefForClient(briefId, clientId);
  const workspace = await prisma.comparisonWorkspace.findUnique({ where: { briefId } });
  const selections = readSelections(workspace);

  if (selections.length < 2) {
    const state = await openWorkspace(briefId, clientId);
    return {
      ...state,
      aiSummaryNotice: "Select at least two quotations before requesting an AI comparison.",
    };
  }

  const quotations = await prisma.quotation.findMany({
    where: { id: { in: selections } },
    include: { freelancer: { select: { displayName: true } } },
  });

  const outcome = await generateComparisonSummary(
    quotations.map((quotation) => {
      const column = toColumn(quotation);
      return {
        id: quotation.id,
        freelancerName: column.freelancerName,
        total: column.total,
        timelineDays: column.timelineDays,
        lineItemCount: column.lineItems.length,
        submittedAt: column.submittedAt,
        lineItems: column.lineItems.map((item) => ({ description: item.description, price: item.price })),
        notes: column.notes,
      };
    }),
  );

  if (!outcome.available || !outcome.summary) {
    const state = await openWorkspace(briefId, clientId);
    return { ...state, aiSummaryNotice: outcome.notice ?? AI_COMPARISON_UNAVAILABLE };
  }

  const target = workspace ?? (await ensureWorkspace(briefId, clientId));
  const summary = outcome.summary;

  await withTransaction(async (tx) => {
    await tx.comparisonWorkspace.update({
      where: { id: target.id },
      data: { aiSummary: summary as unknown as object },
    });
    await writeAuditLog(tx, {
      eventType: "COMPARISON_AI_SUMMARY_GENERATED",
      actorId: clientId,
      resourceId: target.id,
      resourceType: "ComparisonWorkspace",
      previousState: null,
      newState: "AI_SUMMARY_GENERATED",
      metadata: {
        briefId,
        engine: outcome.engine,
        latencyMs: outcome.latencyMs,
        groundedQuotationIds: summary.groundedQuotationIds,
      },
    });
  });

  const state = await openWorkspace(briefId, clientId);
  return { ...state, aiSummary: summary, aiSummaryNotice: null };
}

/**
 * Requirement 8.7 — private Client annotation, 1–500 characters.
 */
export async function saveAnnotation(
  briefId: string,
  clientId: string,
  input: { quotationId: string; attribute: string; noteText: string },
): Promise<ComparisonWorkspaceState> {
  await loadBriefForClient(briefId, clientId);
  await assertComparableQuotation(input.quotationId, briefId);

  const noteText = input.noteText.trim();
  if (noteText.length < ANNOTATION_MIN_LENGTH || noteText.length > ANNOTATION_MAX_LENGTH) {
    throw new ValidationError([
      {
        field: "noteText",
        message: `Annotation must be between ${ANNOTATION_MIN_LENGTH} and ${ANNOTATION_MAX_LENGTH} characters.`,
      },
    ]);
  }
  const attribute = input.attribute.trim();
  if (attribute.length === 0 || attribute.length > 120) {
    throw new ValidationError([{ field: "attribute", message: "Attribute must be 1–120 characters." }]);
  }

  const workspace = await ensureWorkspace(briefId, clientId);

  await withTransaction(async (tx) => {
    await tx.comparisonAnnotation.upsert({
      where: {
        workspaceId_quotationId_attribute: {
          workspaceId: workspace.id,
          quotationId: input.quotationId,
          attribute,
        },
      },
      create: {
        workspaceId: workspace.id,
        quotationId: input.quotationId,
        attribute,
        noteText,
        clientId,
      },
      update: { noteText, clientId },
    });
    await writeAuditLog(tx, {
      eventType: "COMPARISON_ANNOTATION_SAVED",
      actorId: clientId,
      resourceId: workspace.id,
      resourceType: "ComparisonWorkspace",
      previousState: null,
      newState: "ANNOTATION_SAVED",
      metadata: { briefId, quotationId: input.quotationId, attribute },
    });
  });

  return openWorkspace(briefId, clientId);
}

/** Removes a single annotation. */
export async function deleteAnnotation(
  briefId: string,
  clientId: string,
  input: { quotationId: string; attribute: string },
): Promise<ComparisonWorkspaceState> {
  await loadBriefForClient(briefId, clientId);
  const workspace = await prisma.comparisonWorkspace.findUnique({ where: { briefId } });
  if (workspace) {
    await prisma.comparisonAnnotation.deleteMany({
      where: { workspaceId: workspace.id, quotationId: input.quotationId, attribute: input.attribute },
    });
  }
  return openWorkspace(briefId, clientId);
}

/**
 * Requirement 8.10 — structured PDF export. Failure throws so the caller can
 * show an error while the workspace contents stay intact.
 */
export async function exportWorkspacePDF(
  briefId: string,
  clientId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const state = await openWorkspace(briefId, clientId);
  if (!state.available) {
    throw new ConflictError(
      "COMPARISON_NOT_AVAILABLE",
      "At least two submitted quotations are required to export a comparison.",
    );
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595, 842]); // A4 portrait
  let y = 800;
  const left = 48;

  const write = (text: string, size = 10, useBold = false) => {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(text.slice(0, 110), {
      x: left,
      y,
      size,
      font: useBold ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= size + 6;
  };

  write("PactFlow — Quotation Comparison", 18, true);
  write(`Brief: ${state.briefTitle}`, 12);
  write(`Exported: ${new Date().toISOString()}`, 9);
  y -= 8;

  for (const column of state.columns) {
    write(`${column.freelancerName} (${column.status})`, 13, true);
    write(`Total: ${formatUsd(column.total)}   Timeline: ${column.timelineDays} days`, 10);
    write(
      `Submitted: ${column.submittedAt ? column.submittedAt.toISOString() : "not recorded"}`,
      9,
    );
    for (const item of column.lineItems) {
      write(`  • ${item.description || "(no description)"} — ${formatUsd(item.price)}`, 9);
    }
    if (column.notes) write(`  Notes: ${column.notes}`, 9);
    const own = state.annotations.filter((annotation) => annotation.quotationId === column.quotationId);
    for (const annotation of own) {
      write(`  [Note: ${annotation.attribute}] ${annotation.noteText}`, 9);
    }
    y -= 8;
  }

  if (state.aiSummary) {
    write("AI comparison summary", 13, true);
    write(state.aiSummary.summary, 9);
    for (const difference of state.aiSummary.keyDifferences) {
      write(`${difference.attribute}: ${difference.comparison}`, 9);
    }
  }

  const bytes = await pdf.save();

  const workspace = await prisma.comparisonWorkspace.findUnique({ where: { briefId } });
  if (workspace) {
    await withTransaction(async (tx) => {
      await tx.comparisonWorkspace.update({
        where: { id: workspace.id },
        data: { exportedAt: new Date() },
      });
      await writeAuditLog(tx, {
        eventType: "COMPARISON_EXPORTED",
        actorId: clientId,
        resourceId: workspace.id,
        resourceType: "ComparisonWorkspace",
        previousState: null,
        newState: "PDF_EXPORTED",
        metadata: { briefId, columns: state.columns.length },
      });
    });
  }

  return {
    buffer: Buffer.from(bytes),
    fileName: `pactflow-comparison-${briefId}.pdf`,
  };
}

/**
 * Requirement 8.8 — accepting a Quotation from inside the workspace hands the
 * caller the Agreement that was created, with the Quotation pre-loaded.
 */
export async function acceptFromWorkspace(
  briefId: string,
  clientId: string,
  quotationId: string,
): Promise<{ agreementId: string }> {
  await loadBriefForClient(briefId, clientId);
  await assertComparableQuotation(quotationId, briefId);
  const agreement = await createAgreementFromQuotation(quotationId, clientId);
  return { agreementId: agreement.id };
}

/** Guard used by Freelancer-facing routes: annotations are Client-only. */
export async function assertWorkspaceOwner(briefId: string, userId: string): Promise<void> {
  const brief = await prisma.brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError("Brief");
  if (brief.clientId !== userId) {
    await recordAccessViolation({
      actorId: userId,
      resourceId: briefId,
      resourceType: "ComparisonWorkspace",
      reason: "NOT_BRIEF_OWNER",
    });
    throw new ForbiddenError("NOT_BRIEF_OWNER", "Only the owning Client may use the comparison workspace.");
  }
}

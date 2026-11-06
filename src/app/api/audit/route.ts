import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseQuery } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";
import { isPlatformOperator } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { listWebhookEvents } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  resourceType: z.string().min(1).optional(),
});

/**
 * Requirements 18.8 / 24.1 / 24.4 — read-only audit and webhook log.
 *
 * Entry is restricted to authenticated platform operators (OPERATOR_EMAILS).
 * The tables are append-only: this route exposes no mutation verb at all.
 */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireSession();
  if (!isPlatformOperator(user.email)) {
    throw new ForbiddenError("OPERATOR_ONLY", "This view is restricted to platform operators.");
  }

  const { limit, resourceType } = parseQuery(req, QuerySchema);
  const take = limit ?? 200;

  const [auditLog, webhookEvents] = await Promise.all([
    prisma.auditLog.findMany({
      where: resourceType ? { resourceType } : {},
      orderBy: { createdAt: "desc" },
      take,
    }),
    listWebhookEvents(Math.min(take, 100)),
  ]);

  return json({
    auditLog: auditLog.map((entry) => ({
      id: entry.id,
      eventType: entry.eventType,
      actorId: entry.actorId,
      resourceId: entry.resourceId,
      resourceType: entry.resourceType,
      previousState: entry.previousState,
      newState: entry.newState,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    })),
    webhookEvents: webhookEvents.map((event) => ({
      id: event.id,
      paypalEventId: event.paypalEventId,
      eventType: event.eventType,
      signatureVerified: event.signatureVerified,
      isDuplicate: event.isDuplicate,
      processedAt: event.processedAt?.toISOString() ?? null,
      processingError: event.processingError,
      receivedAt: event.receivedAt.toISOString(),
    })),
    retention: {
      minimumYears: 2,
      note: "AuditLog and WebhookEvent rows are append-only and retained for at least two years.",
    },
  });
});

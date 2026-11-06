import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { withTransaction, writeAuditLog, type TxClient } from "@/lib/audit";

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  payload?: Record<string, unknown>;
  /** Payment notifications must be delivered with retries (Requirement 17.7). */
  guaranteed?: boolean;
}

/**
 * Queues an in-platform notification. Delivery happens through the polling
 * endpoint / background dispatcher within the 60-second window required by
 * Requirements 3.3, 7.3 and 10.4.
 */
export async function send(input: NotificationInput, tx?: TxClient): Promise<{ id: string }> {
  const data = {
    userId: input.userId,
    type: input.type,
    payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    guaranteed: input.guaranteed ?? false,
  };
  if (tx) {
    return tx.notification.create({ data, select: { id: true } });
  }
  return prisma.notification.create({ data, select: { id: true } });
}

export async function sendMany(inputs: NotificationInput[], tx?: TxClient): Promise<void> {
  for (const input of inputs) {
    await send(input, tx);
  }
}

export async function markDelivered(notificationId: string): Promise<void> {
  await prisma.notification.update({
    where: { id: notificationId },
    data: { deliveredAt: new Date() },
  });
}

/** Retry backoff: 5s initial, doubling, capped at 5 minutes, 10 attempts max. */
export const MAX_DELIVERY_ATTEMPTS = 10;
export const INITIAL_RETRY_DELAY_MS = 5_000;
export const MAX_RETRY_DELAY_MS = 300_000;

export function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

/**
 * Attempts guaranteed delivery with exponential backoff. After exhausting the
 * retries the failure is escalated to the platform operator (Requirement 17.7).
 */
export async function deliverGuaranteed(notificationId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    try {
      const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
      if (!notification) return false;
      if (notification.deliveredAt) return true;
      await markDelivered(notificationId);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.notification.update({
        where: { id: notificationId },
        data: { retryCount: attempt, lastError: message },
      });
      if (attempt === MAX_DELIVERY_ATTEMPTS) {
        await escalate(notificationId, message);
        return false;
      }
      await sleep(retryDelayMs(attempt));
    }
  }
  return false;
}

async function escalate(notificationId: string, reason: string): Promise<void> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return;
  await prisma.notification.update({
    where: { id: notificationId },
    data: { escalatedAt: new Date(), lastError: reason },
  });
  try {
    await withTransaction(async (tx) => {
      await writeAuditLog(tx, {
        eventType: "NOTIFICATION_ESCALATED",
        actorId: notification.userId,
        resourceId: notificationId,
        resourceType: "Notification",
        previousState: "UNDELIVERED",
        newState: "ESCALATED",
        metadata: { reason },
      });
    });
  } catch (error) {
    console.error("[notify] escalation audit failed", error);
  }
  if (env.operatorAlertWebhook) {
    try {
      await fetch(env.operatorAlertWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId, reason }),
      });
    } catch (error) {
      console.error("[notify] operator alert webhook failed", error);
    }
  }
  console.error(`[notify] ESCALATED notification ${notificationId}: ${reason}`);
}

/** Polling payload for the client bell (undelivered + recently delivered). */
export async function pollNotifications(userId: string) {
  const [pending, recent] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, deliveredAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.notification.findMany({
      where: { userId, deliveredAt: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  return { pending, recent };
}

/**
 * Background dispatcher: marks queued notifications delivered and retries
 * guaranteed ones that previously failed.
 */
export async function deliverPending(limit = 100): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: { deliveredAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let delivered = 0;
  for (const notification of pending) {
    if (notification.guaranteed) {
      const ok = await deliverGuaranteed(notification.id);
      if (ok) delivered += 1;
      continue;
    }
    if (notification.retryCount >= MAX_DELIVERY_ATTEMPTS) {
      await escalate(notification.id, notification.lastError ?? "retry budget exhausted");
      continue;
    }
    await markDelivered(notification.id);
    delivered += 1;
  }
  return delivered;
}

/** Fire-and-forget guaranteed delivery used right after a payment capture. */
export function deliverGuaranteedInBackground(notificationIds: string[]): void {
  for (const id of notificationIds) {
    setTimeout(() => {
      void deliverGuaranteed(id);
    }, 0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

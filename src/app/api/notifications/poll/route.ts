import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { markDelivered, pollNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * Requirement 3.3 / 7.3 / 10.4 — the client bell polls this endpoint. Queued
 * notifications are acknowledged here, which is what keeps in-platform delivery
 * inside the 60-second window.
 */
export const GET = handler(async () => {
  const user = await requireSession();
  const { pending, recent } = await pollNotifications(user.id);

  await Promise.all(pending.map((notification) => markDelivered(notification.id)));

  return json({
    pending: pending.map((notification) => ({
      id: notification.id,
      type: notification.type,
      payload: notification.payload,
      createdAt: notification.createdAt.toISOString(),
      guaranteed: notification.guaranteed,
    })),
    recent: recent.map((notification) => ({
      id: notification.id,
      type: notification.type,
      payload: notification.payload,
      createdAt: notification.createdAt.toISOString(),
      deliveredAt: notification.deliveredAt?.toISOString() ?? null,
      escalatedAt: notification.escalatedAt?.toISOString() ?? null,
    })),
  });
});

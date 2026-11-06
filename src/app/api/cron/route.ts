import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth/session";
import { isPlatformOperator } from "@/lib/access";
import { env } from "@/lib/env";
import { checkOverdueMilestones } from "@/lib/milestones";
import { expireStaleChangeRequests } from "@/lib/change-requests";
import { remindStaleDeliverables } from "@/lib/deliverables/review";
import { deliverPending } from "@/lib/notifications";

/**
 * Scheduled maintenance entry point for the three cron functions plus the
 * notification dispatch sweep (Requirements 7.6, 12.5, 13.6, 15.7).
 *
 * These jobs move state on behalf of the platform rather than a participant, so
 * they are never reachable from a normal session: the caller must present the
 * shared `CRON_SECRET` bearer token, or be an authenticated platform operator.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function authorize(req: NextRequest): Promise<"CRON_SECRET" | "OPERATOR"> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

  if (env.cronSecret !== "" && bearer !== "" && constantTimeEquals(bearer, env.cronSecret)) {
    return "CRON_SECRET";
  }

  // Fallback so the jobs can still be exercised from the dashboard in a demo.
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  if (!isPlatformOperator(user.email)) {
    throw new ForbiddenError("NOT_PLATFORM_OPERATOR", "Only platform operators may run scheduled jobs.");
  }
  return "OPERATOR";
}

async function runJobs() {
  const now = new Date();

  const overdueMilestones = await checkOverdueMilestones(now);
  const changeRequests = await expireStaleChangeRequests(now);
  const staleDeliverableReminders = await remindStaleDeliverables(now);
  const notificationsDelivered = await deliverPending();

  return {
    ranAt: now.toISOString(),
    results: {
      overdueMilestones,
      changeRequestRemindersSent: changeRequests.remindersSent,
      changeRequestsExpired: changeRequests.expired,
      staleDeliverableReminders,
      notificationsDelivered,
    },
  };
}

export const GET = handler(async (req: NextRequest) => {
  const authorizedBy = await authorize(req);
  return json({ ...(await runJobs()), authorizedBy });
});

export const POST = GET;

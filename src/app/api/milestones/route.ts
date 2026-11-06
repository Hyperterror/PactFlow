import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson, parseQuery } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { assertAgreementParticipant } from "@/lib/access";
import { CreateMilestoneSchema, createMilestone, listMilestones } from "@/lib/milestones";
import { toMilestoneDto } from "@/lib/serializers";

const QuerySchema = z.object({ agreementId: z.string().min(1, "agreementId is required.") });

/** Requirement 13.6 — dueDate ascending with createdAt as the tiebreaker. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { agreementId } = parseQuery(req, QuerySchema);
  await assertAgreementParticipant(agreementId, user.id);
  const milestones = await listMilestones(agreementId);
  return json({ milestones: milestones.map(toMilestoneDto) });
});

/** Requirement 13.1 — milestones may be defined by either party while ACTIVE. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const input = await parseJson(req, CreateMilestoneSchema);
  const milestone = await createMilestone(user.id, input);
  return json({ milestone: toMilestoneDto(milestone) }, 201);
});

import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { createBriefFromTemplate } from "@/lib/collaboration";
import { toBriefDto } from "@/lib/serializers";

type Params = { params: Promise<{ templateId: string }> };

/**
 * Requirement 22.2/22.3 — every field stays editable before publication, so the
 * overrides are optional and the created Brief is always a DRAFT.
 */
const BodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  budgetMin: z.coerce.number().positive().optional(),
  budgetMax: z.coerce.number().positive().optional(),
  targetDate: z.coerce.date().optional(),
});

export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { templateId } = await params;
  const overrides = await parseJson(req, BodySchema);
  const brief = await createBriefFromTemplate(templateId, user.id, overrides);

  return json({ brief: toBriefDto(brief) }, 201);
});

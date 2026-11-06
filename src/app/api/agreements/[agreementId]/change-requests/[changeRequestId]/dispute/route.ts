import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { disputeScopeLabel } from "@/lib/change-requests";

type Params = { params: Promise<{ agreementId: string; changeRequestId: string }> };

const DisputeBodySchema = z.object({
  justification: z.string().trim().min(1, "A justification is required."),
});

/**
 * Requirement 11.4/11.6 — disputes need a 10–2000 character justification and
 * never mutate the AI label; the dispute is recorded alongside it.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { changeRequestId } = await params;
  const { justification } = await parseJson(req, DisputeBodySchema);
  const result = await disputeScopeLabel(changeRequestId, user.id, justification);

  return json({ disputeId: result.disputeId, scopeLabel: result.scopeLabel }, 201);
});

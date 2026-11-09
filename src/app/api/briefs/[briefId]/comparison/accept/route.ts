import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { acceptFromWorkspace } from "@/lib/quotations/comparison";

type Params = { params: Promise<{ briefId: string }> };

const AcceptSchema = z.object({
  quotationId: z.string().min(1, "quotationId is required."),
});

/**
 * Selecting a proposal (from the workspace or the quotation page) opens an
 * Engagement and returns its id. 201 the first time, 200 on a repeat.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const { quotationId } = await parseJson(req, AcceptSchema);
  const { engagementId, created } = await acceptFromWorkspace(briefId, user.id, quotationId);
  return json({ engagementId }, created ? 201 : 200);
});

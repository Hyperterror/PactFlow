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
 * Requirement 8.10 — accepting from the workspace creates the Agreement through
 * exactly the same path as the quotation detail page.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const { quotationId } = await parseJson(req, AcceptSchema);
  const { agreementId } = await acceptFromWorkspace(briefId, user.id, quotationId);
  return json({ agreementId }, 201);
});

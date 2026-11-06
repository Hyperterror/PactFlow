import type { NextRequest } from "next/server";
import { handler } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { exportWorkspacePDF } from "@/lib/quotations/comparison";

type Params = { params: Promise<{ briefId: string }> };

export const runtime = "nodejs";

/** Requirement 8.8 — exports the comparison, including the private annotations. */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const { buffer, fileName } = await exportWorkspacePDF(briefId, user.id);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store",
    },
  });
});

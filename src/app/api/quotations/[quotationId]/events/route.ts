import type { NextRequest } from "next/server";
import { handler } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getQuotationForViewer } from "@/lib/quotations";

type Params = { params: Promise<{ quotationId: string }> };

export const dynamic = "force-dynamic";

/**
 * Requirement 6.4 — Server-Sent Events stream so a withdrawn quotation
 * disappears from an open Client view without a manual refresh.
 */
export const GET = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  // Validates participation before the stream is opened.
  await getQuotationForViewer(quotationId, user.id);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({ type: "connected", quotationId });

      timer = setInterval(async () => {
        try {
          const { quotation } = await getQuotationForViewer(quotationId, user.id);
          send({ type: "state", status: quotation.status });
        } catch {
          send({ type: "error", code: "QUOTATION_UNAVAILABLE" });
        }
      }, 5_000);

      req.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
});

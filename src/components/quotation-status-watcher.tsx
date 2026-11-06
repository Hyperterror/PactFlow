"use client";

import { useEffect, useRef } from "react";
import { useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Requirement 6.4 — a withdrawn quotation must not linger in an open Client
 * view. The route handler owns the SSE stream; this only reacts to it.
 */
export function QuotationStatusWatcher({ quotationId, status }: { quotationId: string; status: string }) {
  const refresh = useServerRefresh();
  const current = useRef(status);

  useEffect(() => {
    current.current = status;
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/quotations/${quotationId}/events`);

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; status?: string };
        if (payload.type === "state" && payload.status && payload.status !== current.current) {
          current.current = payload.status;
          refresh();
        }
      } catch {
        // Malformed frame: the next poll will correct the view.
      }
    };

    source.onerror = () => source.close();
    return () => source.close();
  }, [quotationId, refresh]);

  return null;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, buttonClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { navigateAfterMutation } from "@/lib/use-server-refresh";

type CaptureResponse = {
  payment: { milestoneId: string; status: string };
  captured: boolean;
  reviewRequired: boolean;
  reason: string | null;
};

type State =
  | { phase: "capturing" }
  | { phase: "pending" }
  | { phase: "review" }
  | { phase: "declined" }
  | { phase: "error"; message: string };

/**
 * Captures the approved order as soon as the payer lands back from PayPal.
 * The ref guard keeps React's dev double-mount from firing a second request;
 * the server is idempotent anyway (stored PayPal-Request-Id, status re-read in
 * the capture transaction).
 */
export function PaymentReturn({ orderId, milestoneId }: { orderId: string; milestoneId: string }) {
  const started = useRef(false);
  const [state, setState] = useState<State>({ phase: "capturing" });

  const capture = useCallback(async () => {
    setState({ phase: "capturing" });
    try {
      const data = await apiRequest<CaptureResponse>("/api/payments/capture", {
        method: "POST",
        body: JSON.stringify({ paypalOrderId: orderId }),
      });
      if (data.captured) {
        navigateAfterMutation(`/delivery/${data.payment.milestoneId}`);
        return;
      }
      if (data.reviewRequired) setState({ phase: "review" });
      else if (data.payment.status === "FAILED") setState({ phase: "declined" });
      else setState({ phase: "pending" });
    } catch (thrown) {
      setState({ phase: "error", message: errorMessage(thrown) });
    }
  }, [orderId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void capture();
  }, [capture]);

  const checkoutUrl = `/delivery/${milestoneId}/checkout`;

  return (
    <div className="space-y-4" aria-live="polite">
      {state.phase === "capturing" ? (
        <div className="rounded-card border border-border-base bg-surface p-6 text-center shadow-sm">
          <p className="text-sm font-medium">Confirming your payment with PayPal…</p>
          <p className="mt-2 text-xs text-muted">
            Order <span className="font-mono">{orderId}</span>. Keep this tab open; it takes a few seconds.
          </p>
        </div>
      ) : null}

      {state.phase === "pending" ? (
        <Alert tone="warning" title="PayPal is still settling this payment">
          The capture was accepted but is not complete yet. The file unlocks automatically when PayPal confirms it.
        </Alert>
      ) : null}

      {state.phase === "review" ? (
        <Alert tone="warning" title="Payment held for review">
          The amount or currency PayPal reported does not match the agreement, so the file stays locked. An operator
          has been alerted.
        </Alert>
      ) : null}

      {state.phase === "declined" ? (
        <Alert tone="danger" title="Payment declined">
          PayPal declined the funding source. Nothing was charged. Go back to checkout to pay with another method.
        </Alert>
      ) : null}

      {state.phase === "error" ? (
        <Alert tone="danger" title="Capture did not go through">
          {state.message}
        </Alert>
      ) : null}

      {state.phase !== "capturing" ? (
        <div className="flex flex-wrap gap-2">
          {state.phase === "error" ? (
            <button type="button" className={buttonClass("primary", "md")} onClick={() => void capture()}>
              Try again
            </button>
          ) : null}
          <Link
            href={state.phase === "declined" ? checkoutUrl : `/delivery/${milestoneId}`}
            className={buttonClass(state.phase === "error" ? "secondary" : "primary", "md")}
          >
            {state.phase === "declined" ? "Back to checkout" : "Go to delivery room"}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

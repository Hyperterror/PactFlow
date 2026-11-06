"use client";

import { useState } from "react";
import { Alert, buttonClass } from "@/components/ui";
import { errorMessage, apiRequest } from "@/lib/api-client";
import { useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Requirement 3.4/3.5 — accepting an invitation is what grants the Freelancer
 * access to the Brief; declining closes the door without touching the Brief.
 */
export function InvitationActions({ invitationId }: { invitationId: string }) {
  const refresh = useServerRefresh();
  const [pendingAction, setPendingAction] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "accept" | "decline") {
    setPendingAction(action);
    setError(null);
    try {
      await apiRequest(`/api/invitations/${invitationId}/${action}`, { method: "POST" });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass("primary", "sm")}
          onClick={() => void run("accept")}
          disabled={pendingAction !== null}
        >
          {pendingAction === "accept" ? "Accepting…" : "Accept"}
        </button>
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          onClick={() => void run("decline")}
          disabled={pendingAction !== null}
        >
          {pendingAction === "decline" ? "Declining…" : "Decline"}
        </button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

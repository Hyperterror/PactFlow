"use client";

import { useState, type FormEvent } from "react";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui";
import { ApiRequestError, apiRequest, errorMessage } from "@/lib/api-client";
import { useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Requirements 2.6/2.7 — a Brief can only be published from DRAFT and only
 * closed from OPEN. Both transitions are decided by the backend; this component
 * just offers the buttons that match the current state.
 */
export function BriefLifecycleActions({ briefId, status }: { briefId: string; status: string }) {
  const refresh = useServerRefresh();
  const [pending, setPending] = useState<"publish" | "close" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "publish" | "close") {
    setPending(action);
    setError(null);
    try {
      await apiRequest(`/api/briefs/${briefId}/${action}`, { method: "POST" });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" ? (
          <button
            type="button"
            className={buttonClass("primary", "md")}
            onClick={() => void run("publish")}
            disabled={pending !== null}
          >
            {pending === "publish" ? "Publishing…" : "Publish brief"}
          </button>
        ) : null}
        {status === "OPEN" ? (
          <button
            type="button"
            className={buttonClass("secondary", "md")}
            onClick={() => void run("close")}
            disabled={pending !== null}
          >
            {pending === "close" ? "Closing…" : "Close to new quotations"}
          </button>
        ) : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

/**
 * Requirement 3.1/3.2 — invitations are addressed to a registered account. The
 * email form is the pragmatic path when the Client does not know the user id.
 */
export function InviteFreelancerForm({ briefId }: { briefId: string }) {
  const refresh = useServerRefresh();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldError(undefined);
    setSent(null);

    try {
      await apiRequest("/api/invitations", {
        method: "POST",
        body: JSON.stringify({ briefId, freelancerEmail: email.trim() }),
      });
      setSent(email.trim());
      setEmail("");
      refresh();
    } catch (thrown) {
      if (thrown instanceof ApiRequestError) {
        const fields = thrown.fieldMap();
        setFieldError(fields.freelancerEmail ?? fields.freelancerId);
        if (!fields.freelancerEmail && !fields.freelancerId) setError(thrown.message);
      } else {
        setError(errorMessage(thrown));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <Field
        label="Invite a freelancer"
        htmlFor="freelancerEmail"
        error={fieldError}
        hint="They must already have a PactFlow account. Up to 50 invitations per brief."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="freelancerEmail"
            type="email"
            className={inputClass}
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="freelancer@studio.com"
          />
          <button type="submit" className={buttonClass("secondary", "md")} disabled={pending}>
            {pending ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </Field>
      {sent ? <Alert tone="success">Invitation sent to {sent}.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
}

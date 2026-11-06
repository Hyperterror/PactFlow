"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, buttonClass, Card, CardBody, CardHeader, Field, textareaClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { useServerRefresh } from "@/lib/use-server-refresh";

interface LatestDeliverable {
  id: string;
  status: string;
  versionNumber: number;
  revisionCount: number;
}

interface PaymentInfo {
  id: string;
  status: string;
  approveUrl: string | null;
}

const MIN_FEEDBACK = 10;
const MAX_FEEDBACK = 5000;

/**
 * Delivery Room controls.
 *
 * Requirements 14.1 / 15.1–15.9 / 16.5 / 19.1: the Freelancer uploads and marks
 * delivered, the Client reviews and approves, and the original file unlocks only
 * once the payment is captured — every gate lives on the server.
 */
export function DeliveryActions({
  milestoneId,
  milestoneStatus,
  role,
  revisionLimit,
  latestDeliverable,
  payment,
}: {
  milestoneId: string;
  milestoneStatus: string;
  role: "CLIENT" | "FREELANCER";
  revisionLimit: number;
  latestDeliverable: LatestDeliverable | null;
  payment: PaymentInfo | null;
}) {
  const router = useRouter();
  const refresh = useServerRefresh();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const materialisedLimit = Math.max(0, revisionLimit - (latestDeliverable?.revisionCount ?? 0));

  async function run(label: string, path: string, init?: RequestInit, message?: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(path, { method: "POST", ...init });
      if (message) setNotice(message);
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF file first.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF deliverables are accepted.");
      return;
    }
    const form = new FormData();
    form.append("milestoneId", milestoneId);
    form.append("file", file);
    await run("upload", "/api/deliverables", { body: form }, "Deliverable uploaded and hashed.");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function downloadOriginal() {
    if (!latestDeliverable) return;
    setBusy("download");
    setError(null);
    try {
      const data = await apiRequest<{ url: string }>(`/api/deliverables/${latestDeliverable.id}/download`);
      window.location.href = data.url;
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function pay() {
    setBusy("pay");
    setError(null);
    try {
      const data = await apiRequest<{ approveUrl: string }>("/api/payments", {
        method: "POST",
        body: JSON.stringify({ milestoneId }),
      });
      if (data.approveUrl) {
        window.location.href = data.approveUrl;
        return;
      }
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {role === "FREELANCER" ? (
        <Card>
          <CardHeader
            title="Upload deliverable"
            description="PDF only, up to 50 MB. Every upload gets its own version and a SHA-256 hash of the exact bytes."
            actions={
              <span className="text-xs text-muted">
                {latestDeliverable ? `Latest version ${latestDeliverable.versionNumber}` : "No upload yet"}
              </span>
            }
          />
          <CardBody className="space-y-3">
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              aria-label="Deliverable PDF"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass("primary", "md")}
                onClick={() => void upload()}
                disabled={busy !== null || milestoneStatus === "APPROVED"}
              >
                {busy === "upload" ? "Uploading…" : "Upload PDF"}
              </button>
              <button
                type="button"
                className={buttonClass("secondary", "md")}
                onClick={() =>
                  void run(
                    "deliver",
                    `/api/milestones/${milestoneId}/deliver`,
                    undefined,
                    "Milestone marked delivered. The client has been notified.",
                  )
                }
                disabled={busy !== null || milestoneStatus === "DELIVERED" || milestoneStatus === "APPROVED"}
              >
                {busy === "deliver" ? "Marking…" : "Mark delivered"}
              </button>
            </div>
            <p className="text-xs text-muted">
              {materialisedLimit} of {revisionLimit} revision rounds remain for this deliverable.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {role === "CLIENT" && latestDeliverable ? (
        <Card>
          <CardHeader
            title="Review"
            description="Approving the work unlocks payment. Requesting a revision does not."
            actions={
              <a
                href={`/api/deliverables/${latestDeliverable.id}/preview`}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("secondary", "sm")}
              >
                Open preview
              </a>
            }
          />
          <CardBody className="space-y-3">
            {latestDeliverable.status === "UPLOADED" ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass("success", "md")}
                    onClick={() =>
                      void run(
                        "approve-work",
                        `/api/deliverables/${latestDeliverable.id}/approve`,
                        undefined,
                        "Work approved. Approve the milestone to enable payment.",
                      )
                    }
                    disabled={busy !== null}
                  >
                    {busy === "approve-work" ? "Approving…" : "Approve work"}
                  </button>
                  <button
                    type="button"
                    className={buttonClass("secondary", "md")}
                    onClick={() => setShowFeedback((open) => !open)}
                    disabled={busy !== null || materialisedLimit === 0}
                    title={materialisedLimit === 0 ? "The revision limit has been reached." : undefined}
                  >
                    {showFeedback ? "Cancel revision" : "Request revision"}
                  </button>
                </div>

                {showFeedback ? (
                  <Field
                    label="Revision feedback"
                    htmlFor="feedback"
                    required
                    hint={`${MIN_FEEDBACK}–${MAX_FEEDBACK} characters. Be specific: the Freelancer only sees this text.`}
                  >
                    <textarea
                      id="feedback"
                      className={textareaClass}
                      rows={4}
                      maxLength={MAX_FEEDBACK}
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        className={buttonClass("primary", "sm")}
                        disabled={busy !== null || feedback.trim().length < MIN_FEEDBACK}
                        onClick={() =>
                          void run(
                            "revise",
                            `/api/deliverables/${latestDeliverable.id}/revise`,
                            { body: JSON.stringify({ feedbackText: feedback.trim() }) },
                            "Revision requested.",
                          )
                        }
                      >
                        {busy === "revise" ? "Sending…" : "Send revision request"}
                      </button>
                    </div>
                  </Field>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted">
                This version is {latestDeliverable.status.toLowerCase().replaceAll("_", " ")}.
              </p>
            )}

            <p className="text-xs text-muted">
              {materialisedLimit} of {revisionLimit} revision rounds remain.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {role === "CLIENT" ? (
        <Card>
          <CardHeader
            title="Payment"
            description="The original file stays locked until PayPal confirms the capture."
            actions={payment ? <span className="text-xs text-muted">Payment {payment.status.toLowerCase()}</span> : null}
          />
          <CardBody className="space-y-3">
            {milestoneStatus !== "APPROVED" && payment?.status !== "CAPTURED" ? (
              <button
                type="button"
                className={buttonClass("secondary", "md")}
                onClick={() =>
                  void run(
                    "approve-milestone",
                    `/api/milestones/${milestoneId}/approve`,
                    undefined,
                    "Milestone approved. You can pay now.",
                  )
                }
                disabled={busy !== null || milestoneStatus !== "DELIVERED"}
              >
                {busy === "approve-milestone" ? "Approving…" : "Approve milestone"}
              </button>
            ) : null}

            {payment?.status === "CAPTURED" ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-success">Payment captured. The original file is unlocked.</p>
                <button
                  type="button"
                  className={buttonClass("primary", "md")}
                  onClick={() => void downloadOriginal()}
                  disabled={busy !== null}
                >
                  {busy === "download" ? "Preparing link…" : "Download original (signed link)"}
                </button>
              </div>
            ) : milestoneStatus === "APPROVED" ? (
              <div className="space-y-2">
                {payment && payment.status !== "PENDING" ? (
                  <button
                    type="button"
                    className={buttonClass("secondary", "md")}
                    onClick={() =>
                      void run("retry", "/api/payments/retry", { body: JSON.stringify({ paymentId: payment.id }) })
                    }
                    disabled={busy !== null}
                  >
                    {busy === "retry" ? "Retrying…" : "Retry capture"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={buttonClass("primary", "md")}
                  onClick={() => void pay()}
                  disabled={busy !== null}
                >
                  {busy === "pay" ? "Opening PayPal…" : payment?.status === "PENDING" ? "Continue to PayPal" : "Pay with PayPal"}
                </button>
              </div>
            ) : (
              // A payment can only exist once the milestone is approved, so an
              // unapproved milestone has nothing to continue — offering the
              // control here would only earn a 409 from the server.
              <p className="text-sm text-muted">
                Payment becomes available once the milestone is approved.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

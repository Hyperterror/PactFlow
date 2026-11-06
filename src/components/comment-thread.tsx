"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, textareaClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface ThreadComment {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  isClarificationRequest: boolean;
  clarificationStatus: string | null;
  answeredByCommentId: string | null;
}

/**
 * Requirements 7.1–7.8 — one chronological thread, an OPEN clarification
 * counter, a 15-minute edit window and an explicit "answer" link between a
 * request and its reply.
 */
export function CommentThread({
  quotationId,
  viewerId,
  initialComments,
  initialOpenClarifications,
  canComment,
  editWindowMs,
}: {
  quotationId: string;
  viewerId: string;
  initialComments: ThreadComment[];
  initialOpenClarifications: number;
  canComment: boolean;
  editWindowMs: number;
}) {
  const [comments, setComments] = useState<ThreadComment[]>(initialComments);
  const [openClarifications, setOpenClarifications] = useState(initialOpenClarifications);
  const [draft, setDraft] = useState("");
  const [isClarification, setIsClarification] = useState(false);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `now` is set after mount so the edit-window check never differs between the
  // server-rendered markup and the first client render.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  async function reload() {
    const data = await apiRequest<{ comments: ThreadComment[]; openClarifications: number }>(
      `/api/quotations/${quotationId}/comments`,
    );
    setComments(data.comments);
    setOpenClarifications(data.openClarifications);
  }

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/quotations/${quotationId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          content: draft.trim(),
          isClarificationRequest: answeringId ? false : isClarification,
          ...(answeringId ? { answersCommentId: answeringId } : {}),
        }),
      });
      setDraft("");
      setIsClarification(false);
      setAnsweringId(null);
      await reload();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(commentId: string) {
    if (editDraft.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/quotations/${quotationId}/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editDraft.trim() }),
      });
      setEditingId(null);
      setEditDraft("");
      await reload();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  }

  function withinEditWindow(comment: ThreadComment): boolean {
    if (now === null || comment.authorId !== viewerId || comment.editedAt !== null) return false;
    return new Date(comment.createdAt).getTime() + editWindowMs > now;
  }

  function answerTarget(): ThreadComment | null {
    if (!answeringId) return null;
    return comments.find((comment) => comment.id === answeringId) ?? null;
  }

  return (
    <Card>
      <CardHeader
        title="Discussion"
        description="Clarifications and answers stay attached to this quotation, not to a separate inbox."
        actions={
          <Badge tone={openClarifications > 0 ? "warning" : "neutral"}>
            {openClarifications} open clarification{openClarifications === 1 ? "" : "s"}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {comments.length === 0 ? (
          <EmptyState
            title="No messages yet"
            description="Ask a question, or request clarification on a specific line item."
          />
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => {
              const mine = comment.authorId === viewerId;
              const target = comment.answeredByCommentId
                ? comments.find((candidate) => candidate.id === comment.answeredByCommentId)
                : undefined;
              return (
                <li
                  key={comment.id}
                  className={cn(
                    "rounded-lg border p-3",
                    mine ? "border-border-strong bg-surface-muted" : "border-border-base",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{comment.authorName}</span>
                    <Badge tone={comment.authorRole === "CLIENT" ? "info" : "neutral"}>
                      {humanize(comment.authorRole)}
                    </Badge>
                    {comment.isClarificationRequest ? (
                      <Badge tone={comment.clarificationStatus === "OPEN" ? "warning" : "success"}>
                        {comment.clarificationStatus === "OPEN" ? "Clarification requested" : "Clarification answered"}
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted">{formatDateTime(comment.createdAt)}</span>
                    {comment.editedAt ? <span className="text-xs text-muted">· edited</span> : null}
                  </div>

                  {target ? (
                    <p className="mt-1 truncate text-xs text-muted">Replying to: {target.content}</p>
                  ) : null}

                  {editingId === comment.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        className={textareaClass}
                        rows={3}
                        maxLength={5000}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        aria-label="Edit comment"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={buttonClass("primary", "sm")}
                          onClick={() => void saveEdit(comment.id)}
                          disabled={busy}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className={buttonClass("ghost", "sm")}
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft("");
                          }}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{comment.content}</p>
                  )}

                  {editingId === comment.id ? null : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {withinEditWindow(comment) ? (
                        <button
                          type="button"
                          className={buttonClass("ghost", "sm")}
                          onClick={() => {
                            setEditingId(comment.id);
                            setEditDraft(comment.content);
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                      {canComment && comment.isClarificationRequest && comment.clarificationStatus === "OPEN" && !mine ? (
                        <button
                          type="button"
                          className={buttonClass("secondary", "sm")}
                          onClick={() => setAnsweringId(comment.id)}
                        >
                          Answer
                        </button>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canComment ? (
          <form onSubmit={post} className="space-y-2 border-t border-border-base pt-4">
            {answerTarget() ? (
              <p className="rounded-md bg-info-soft px-3 py-2 text-xs text-info">
                Answering: {answerTarget()?.content}{" "}
                <button
                  type="button"
                  className="ml-1 font-semibold underline"
                  onClick={() => setAnsweringId(null)}
                >
                  clear
                </button>
              </p>
            ) : null}
            <textarea
              className={textareaClass}
              rows={3}
              maxLength={5000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write a message…"
              aria-label="New comment"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={isClarification}
                  onChange={(event) => setIsClarification(event.target.checked)}
                  disabled={answeringId !== null}
                />
                Mark as clarification request
              </label>
              <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || draft.trim().length === 0}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        ) : (
          <Alert tone="info">
            Discussion opens once the quotation is submitted.
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}

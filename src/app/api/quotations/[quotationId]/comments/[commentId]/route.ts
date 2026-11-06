import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { COMMENT_EDIT_WINDOW_MS, EditCommentSchema, editComment } from "@/lib/quotations/comments";

type Params = { params: Promise<{ quotationId: string; commentId: string }> };

/**
 * Requirement 7.5/7.6 — edits are allowed for 15 minutes after creation; the
 * "edited" indicator is written with the new text.
 */
export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId, commentId } = await params;
  const input = await parseJson(req, EditCommentSchema);
  const comment = await editComment(quotationId, commentId, user.id, input);

  return json({
    comment: {
      id: comment.id,
      content: comment.content,
      edited: comment.editedAt !== null,
      editedAt: comment.editedAt?.toISOString() ?? null,
      createdAt: comment.createdAt.toISOString(),
    },
    editWindowMs: COMMENT_EDIT_WINDOW_MS,
  });
});

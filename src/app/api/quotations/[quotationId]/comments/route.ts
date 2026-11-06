import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { PostCommentSchema, listComments, postComment } from "@/lib/quotations/comments";

type Params = { params: Promise<{ quotationId: string }> };

/** Requirement 7.4/7.8 — chronological thread with the OPEN clarification count. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const { comments, openClarifications } = await listComments(quotationId, user.id);

  return json({
    comments: comments.map((comment) => ({
      ...comment,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt?.toISOString() ?? null,
    })),
    openClarifications,
  });
});

/**
 * Requirements 7.1–7.3 — posts a comment, notifies the other party and records
 * a clarification request as OPEN until the answer arrives.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const input = await parseJson(req, PostCommentSchema);
  const comment = await postComment(quotationId, user.id, input);

  return json(
    {
      comment: {
        id: comment.id,
        quotationId: comment.quotationId,
        authorId: comment.authorId,
        content: comment.content,
        isClarificationRequest: comment.isClarificationRequest,
        clarificationStatus: comment.clarificationStatus,
        answeredByCommentId: comment.answeredByCommentId,
        editedAt: comment.editedAt?.toISOString() ?? null,
        createdAt: comment.createdAt.toISOString(),
      },
    },
    201,
  );
});

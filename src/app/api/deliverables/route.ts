import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { MAX_DELIVERABLE_BYTES } from "@/lib/pdf";
import { uploadDeliverable } from "@/lib/deliverables";
import { toDeliverableDto } from "@/lib/serializers";

export const runtime = "nodejs";

/**
 * Requirements 14.1–14.10 — multipart upload of a PDF deliverable.
 *
 * The size ceiling is checked again here so an oversized body is rejected before
 * the bytes are ever buffered into the storage driver.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError([{ field: "(root)", message: "Expected multipart/form-data." }]);
  }

  const milestoneId = form.get("milestoneId");
  if (typeof milestoneId !== "string" || milestoneId.length === 0) {
    throw new ValidationError([{ field: "milestoneId", message: "milestoneId is required." }]);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError([{ field: "file", message: "A PDF file is required." }]);
  }
  if (file.size > MAX_DELIVERABLE_BYTES) {
    throw new ValidationError([
      { field: "file", message: "File too large: the maximum deliverable size is 50 MB." },
    ]);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const deliverable = await uploadDeliverable(
    milestoneId,
    user.id,
    buffer,
    file.name || "deliverable.pdf",
  );
  return json({ deliverable: toDeliverableDto(deliverable) }, 201);
});

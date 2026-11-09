import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { SaveVersionSchema, saveRequirementsVersion } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** Saves the next immutable requirements version. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const input = await parseJson(req, SaveVersionSchema);
  const version = await saveRequirementsVersion(engagementId, user.id, input);
  return json({ versionNumber: version.versionNumber, versionId: version.id }, 201);
});

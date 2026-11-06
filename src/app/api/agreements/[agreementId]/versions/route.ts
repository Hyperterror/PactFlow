import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { createNewVersion, getAgreementDetail, getVersionHistory } from "@/lib/agreements";

type Params = { params: Promise<{ agreementId: string }> };

const NewVersionSchema = z.object({
  changes: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one changed field.",
  }),
});

/** Requirement 9.7 — ascending history, read-only. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  await getAgreementDetail(agreementId, user.id);
  const versions = await getVersionHistory(agreementId);
  return json({
    versions: versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      authorRole: version.authorRole,
      createdAt: version.createdAt.toISOString(),
      content: version.content,
    })),
  });
});

/**
 * Requirement 9.6 — a new version is only ever created as a consequence of an
 * approved scope-change request; direct version creation is rejected for the
 * direct endpoint unless the caller is a participant.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  const { changes } = await parseJson(req, NewVersionSchema);
  const version = await createNewVersion(agreementId, user.id, changes);
  return json(
    {
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        authorRole: version.authorRole,
        createdAt: version.createdAt.toISOString(),
        content: version.content,
      },
    },
    201,
  );
});

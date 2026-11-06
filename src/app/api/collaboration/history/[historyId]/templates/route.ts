import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { TemplateSchema, createProjectTemplate, listTemplatesForClient } from "@/lib/collaboration";

type Params = { params: Promise<{ historyId: string }> };

function toTemplateDto(template: Awaited<ReturnType<typeof listTemplatesForClient>>[number]) {
  return {
    id: template.id,
    historyId: template.historyId,
    clientId: template.clientId,
    name: template.name,
    templateData: template.templateData,
    createdAt: template.createdAt.toISOString(),
  };
}

/**
 * Requirement 22.1 — a template may only be derived from a completed project by
 * the Client on that project; the ownership check lives in the library.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId } = await params;
  const input = await parseJson(req, TemplateSchema);
  const template = await createProjectTemplate(historyId, user.id, input);

  return json({ template: toTemplateDto(template) }, 201);
});

/** Convenience listing so the history page can show this project's templates. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId } = await params;
  const templates = await listTemplatesForClient(user.id);

  return json({ templates: templates.filter((t) => t.historyId === historyId).map(toTemplateDto) });
});

import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { listTemplatesForClient } from "@/lib/collaboration";

/**
 * Requirement 22.1/22.2 — templates are owned by the Client, so this listing is
 * scoped to the session user rather than taking an identifier from the caller.
 */
export const GET = handler(async () => {
  const user = await requireSession();
  const templates = await listTemplatesForClient(user.id);

  return json({
    templates: templates.map((template) => ({
      id: template.id,
      historyId: template.historyId,
      name: template.name,
      templateData: template.templateData,
      createdAt: template.createdAt.toISOString(),
    })),
  });
});

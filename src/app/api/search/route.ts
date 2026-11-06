import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseQuery } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { searchEverything } from "@/lib/search";

const QuerySchema = z.object({ q: z.string().max(120).default("") });

export const GET = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { q } = parseQuery(req, QuerySchema);
  const results = await searchEverything(user.id, q ?? "");
  return json({ results });
});

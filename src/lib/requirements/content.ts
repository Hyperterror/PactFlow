import { z } from "zod";

/**
 * The requirements brief (BRD) as structured data.
 *
 * A saved version is an immutable JSON snapshot of `RequirementsContent`. Three
 * rules make it trustworthy as a baseline, and all three are enforced here,
 * server-side, on every save — never trusted from the browser:
 *
 *  1. Stable IDs. Every requirement and assumption keeps its ID across
 *     versions, and a new item gets the next number ever used in the document's
 *     lineage, so an ID is never reused for different content.
 *  2. Provenance. Every item carries at least one source reference. An item the
 *     author typed in themselves is attributed to them (PARTY_AUTHORED); nothing
 *     is left unsourced.
 *  3. Confirmation. Unsupported content is flagged "needs confirmation" and
 *     blocks approval until a party confirms it, which is recorded as a source
 *     naming that party's role.
 */

export const SOURCE_TYPES = [
  "BRIEF_FIELD",
  "PROPOSAL_FIELD",
  "DISCOVERY_MESSAGE",
  "CLIENT_CONFIRMED_ASSUMPTION",
  "FREELANCER_CONFIRMED_ASSUMPTION",
  "PARTY_AUTHORED",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];
export type PartyRole = "CLIENT" | "FREELANCER";

export const SourceRefSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  /** Field path (`brief.deliverables[0]`), message id, or party role. */
  ref: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().max(300).optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const PRIORITIES = ["MUST", "SHOULD", "COULD"] as const;

const textItem = (max: number) => z.string().trim().min(1).max(max);

export const RequirementSchema = z.object({
  id: z.string().trim().max(20).default(""),
  title: textItem(200),
  description: z.string().trim().max(2000).default(""),
  priority: z.enum(PRIORITIES).default("MUST"),
  acceptanceCriteria: z.array(textItem(500)).max(20).default([]),
  sources: z.array(SourceRefSchema).max(10).default([]),
  needsConfirmation: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const AssumptionSchema = z.object({
  id: z.string().trim().max(20).default(""),
  text: textItem(500),
  status: z.enum(["NEEDS_CONFIRMATION", "CONFIRMED"]).default("NEEDS_CONFIRMATION"),
  confirmedBy: z.enum(["CLIENT", "FREELANCER"]).optional(),
  sources: z.array(SourceRefSchema).max(10).default([]),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const RequirementsContentSchema = z.object({
  objective: z.string().trim().min(1, "The project objective is required.").max(2000),
  stakeholders: z.array(textItem(200)).max(30).default([]),
  functional: z.array(RequirementSchema).max(60).default([]),
  nonFunctional: z.array(RequirementSchema).max(40).default([]),
  outOfScope: z.array(textItem(500)).max(40).default([]),
  assumptions: z.array(AssumptionSchema).max(40).default([]),
  constraints: z.array(textItem(500)).max(40).default([]),
  successMeasures: z.array(textItem(500)).max(20).default([]),
});
export type RequirementsContent = z.infer<typeof RequirementsContentSchema>;
export type RequirementsContentInput = z.input<typeof RequirementsContentSchema>;

const ID_PREFIX = { functional: "REQ", nonFunctional: "NFR", assumptions: "ASM" } as const;
type IdKind = keyof typeof ID_PREFIX;

function formatId(kind: IdKind, n: number): string {
  return `${ID_PREFIX[kind]}-${String(n).padStart(3, "0")}`;
}

function idNumber(kind: IdKind, id: string): number | null {
  const match = new RegExp(`^${ID_PREFIX[kind]}-(\\d{1,6})$`).exec(id);
  return match ? Number(match[1]) : null;
}

/** Highest number ever used for each ID kind across a document's versions. */
export function lineageMaxima(history: RequirementsContent[]): Record<IdKind, number> {
  const maxima: Record<IdKind, number> = { functional: 0, nonFunctional: 0, assumptions: 0 };
  for (const content of history) {
    for (const kind of Object.keys(ID_PREFIX) as IdKind[]) {
      for (const item of content[kind]) {
        const n = idNumber(kind, item.id);
        if (n !== null && n > maxima[kind]) maxima[kind] = n;
      }
    }
  }
  return maxima;
}

/** Every ID that has ever existed in the lineage, per kind. */
function lineageIds(history: RequirementsContent[]): Record<IdKind, Set<string>> {
  const ids: Record<IdKind, Set<string>> = {
    functional: new Set(),
    nonFunctional: new Set(),
    assumptions: new Set(),
  };
  for (const content of history) {
    for (const kind of Object.keys(ID_PREFIX) as IdKind[]) {
      for (const item of content[kind]) ids[kind].add(item.id);
    }
  }
  return ids;
}

function confirmationSource(role: PartyRole): SourceRef {
  return {
    type: role === "CLIENT" ? "CLIENT_CONFIRMED_ASSUMPTION" : "FREELANCER_CONFIRMED_ASSUMPTION",
    ref: role,
  };
}

function hasSource(sources: SourceRef[], type: SourceType): boolean {
  return sources.some((source) => source.type === type);
}

/**
 * Turns submitted content into the version that will be stored.
 *
 * - IDs: an ID the lineage already knows is kept; anything else (blank, made
 *   up, or duplicated within this submission) gets the next unused number.
 * - Sources: an item with none is attributed to the author (PARTY_AUTHORED).
 * - Confirmation: an assumption that becomes CONFIRMED in this save is
 *   confirmed by the author's role — whatever `confirmedBy` the browser sent is
 *   ignored. One already confirmed earlier keeps its original confirmer. A
 *   requirement whose "needs confirmation" flag is cleared gets a confirmation
 *   source for the author.
 */
export function normalizeContent(
  input: RequirementsContentInput,
  authorRole: PartyRole,
  history: RequirementsContent[],
): RequirementsContent {
  const content = RequirementsContentSchema.parse(input);
  const maxima = lineageMaxima(history);
  const known = lineageIds(history);
  const previous = history.at(-1) ?? null;

  const assign = <T extends { id: string }>(kind: IdKind, items: T[]): T[] => {
    const seen = new Set<string>();
    return items.map((item) => {
      let id = item.id;
      if (!known[kind].has(id) || seen.has(id)) {
        maxima[kind] += 1;
        id = formatId(kind, maxima[kind]);
      }
      seen.add(id);
      return { ...item, id };
    });
  };

  const authored: SourceRef = { type: "PARTY_AUTHORED", ref: authorRole };

  const previousRequirements = new Map(
    [...(previous?.functional ?? []), ...(previous?.nonFunctional ?? [])].map((item) => [item.id, item]),
  );
  const previousAssumptions = new Map((previous?.assumptions ?? []).map((item) => [item.id, item]));

  const fixRequirement = (item: Requirement): Requirement => {
    let sources = item.sources.length > 0 ? item.sources : [authored];
    const before = previousRequirements.get(item.id);
    const wasFlagged = before ? before.needsConfirmation : false;
    if (wasFlagged && !item.needsConfirmation && !hasSource(sources, confirmationSource(authorRole).type)) {
      sources = [...sources, confirmationSource(authorRole)];
    }
    return { ...item, sources };
  };

  const fixAssumption = (item: Assumption): Assumption => {
    const sources = item.sources.length > 0 ? item.sources : [authored];
    if (item.status !== "CONFIRMED") {
      const { confirmedBy: _ignored, ...rest } = item;
      void _ignored;
      return { ...rest, sources };
    }
    const before = previousAssumptions.get(item.id);
    const confirmedBy: PartyRole =
      before?.status === "CONFIRMED" && before.confirmedBy ? before.confirmedBy : authorRole;
    const withConfirmation = hasSource(sources, confirmationSource(confirmedBy).type)
      ? sources
      : [...sources, confirmationSource(confirmedBy)];
    return { ...item, confirmedBy, sources: withConfirmation };
  };

  return {
    ...content,
    functional: assign("functional", content.functional).map(fixRequirement),
    nonFunctional: assign("nonFunctional", content.nonFunctional).map(fixRequirement),
    assumptions: assign("assumptions", content.assumptions).map(fixAssumption),
  };
}

export interface ApprovalBlocker {
  itemId: string | null;
  message: string;
}

/**
 * What stops this version from being approved as the baseline. A version with
 * blockers can still be saved, discussed and revised — just not approved,
 * because the SOW would otherwise inherit unconfirmed or untestable scope.
 */
export function approvalBlockers(content: RequirementsContent): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  if (content.functional.length === 0) {
    blockers.push({ itemId: null, message: "Add at least one functional requirement." });
  }
  for (const item of [...content.functional, ...content.nonFunctional]) {
    if (item.needsConfirmation) {
      blockers.push({ itemId: item.id, message: `${item.id} still needs confirmation.` });
    }
  }
  for (const item of content.functional) {
    if (item.acceptanceCriteria.length === 0) {
      blockers.push({ itemId: item.id, message: `${item.id} has no acceptance criteria.` });
    }
  }
  for (const item of content.assumptions) {
    if (item.status !== "CONFIRMED") {
      blockers.push({ itemId: item.id, message: `${item.id} is an unconfirmed assumption.` });
    }
  }
  return blockers;
}

/** Reads stored JSON back into typed content; malformed rows fail loudly. */
export function parseStoredContent(value: unknown): RequirementsContent {
  return RequirementsContentSchema.parse(value);
}

export function allRequirementIds(content: RequirementsContent): string[] {
  return [...content.functional, ...content.nonFunctional, ...content.assumptions].map((item) => item.id);
}

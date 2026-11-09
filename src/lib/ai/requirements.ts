import type { ZodSchema } from "zod";
import { AITimeoutError, AIValidationError, AI_TIMEOUTS, callLLMWithTimeout } from "@/lib/ai/client";
import { isRealLLMEnabled } from "@/lib/env";
import {
  RequirementsContentSchema,
  type Assumption,
  type Requirement,
  type RequirementsContent,
  type SourceRef,
} from "@/lib/requirements/content";

/**
 * AI drafting of the requirements brief.
 *
 * The draft may use three inputs only: the original brief, the accepted
 * proposal and the Engagement's discovery messages. Every source reference the
 * model returns is checked against that exact set; a reference that does not
 * resolve is dropped, and an item left with no real source is flagged "needs
 * confirmation" instead of being presented as a requirement. The model can
 * never confirm an assumption — only a party can, on save.
 *
 * The draft is returned to the editor, not saved: a person reviews it and saves
 * it as a version.
 */

export interface RequirementsGrounding {
  brief: {
    title: string;
    description: string;
    deliverables: string[];
    budgetMin: number;
    budgetMax: number;
    targetDate: Date;
  };
  proposal: {
    lineItems: Array<{ description: string; price: number }>;
    total: number;
    timelineDays: number;
    notes: string;
  };
  messages: Array<{ id: string; authorRole: "CLIENT" | "FREELANCER"; content: string }>;
  /** When the proposal was selected; the proposed timeline runs from here. */
  selectedAt: Date;
}

export interface RequirementsDraftOutcome {
  generated: boolean;
  content: RequirementsContent | null;
  engine: "llm" | "heuristic";
  notice: string | null;
  /** Source references the model returned that did not resolve and were dropped. */
  droppedSources: number;
}

const GROUNDED_TYPES = new Set(["BRIEF_FIELD", "PROPOSAL_FIELD", "DISCOVERY_MESSAGE"]);

/** Every reference a draft may cite, with the text it points at. */
export function sourceCatalog(input: RequirementsGrounding): Map<string, { type: SourceRef["type"]; text: string }> {
  const catalog = new Map<string, { type: SourceRef["type"]; text: string }>();
  catalog.set("brief.title", { type: "BRIEF_FIELD", text: input.brief.title });
  catalog.set("brief.description", { type: "BRIEF_FIELD", text: input.brief.description });
  input.brief.deliverables.forEach((text, index) =>
    catalog.set(`brief.deliverables[${index}]`, { type: "BRIEF_FIELD", text }),
  );
  catalog.set("brief.budget", {
    type: "BRIEF_FIELD",
    text: `${input.brief.budgetMin}–${input.brief.budgetMax} USD`,
  });
  catalog.set("brief.targetDate", { type: "BRIEF_FIELD", text: isoDate(input.brief.targetDate) });
  input.proposal.lineItems.forEach((item, index) =>
    catalog.set(`proposal.lineItems[${index}]`, { type: "PROPOSAL_FIELD", text: item.description }),
  );
  catalog.set("proposal.timelineDays", { type: "PROPOSAL_FIELD", text: `${input.proposal.timelineDays} days` });
  catalog.set("proposal.total", { type: "PROPOSAL_FIELD", text: `${input.proposal.total} USD` });
  catalog.set("proposal.notes", { type: "PROPOSAL_FIELD", text: input.proposal.notes });
  for (const message of input.messages) {
    catalog.set(`message:${message.id}`, { type: "DISCOVERY_MESSAGE", text: message.content });
  }
  return catalog;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function cite(catalog: ReturnType<typeof sourceCatalog>, ref: string): SourceRef {
  const entry = catalog.get(ref);
  if (!entry) throw new Error(`Unknown source ${ref}`);
  return { type: entry.type, ref, excerpt: excerpt(entry.text) };
}

/**
 * Enforces provenance on any draft, from the model or the heuristic: only
 * grounded references that exist survive, and the type and excerpt always come
 * from the catalog rather than the model. Assumptions are always unconfirmed.
 */
export function enforceProvenance(
  draft: RequirementsContent,
  catalog: ReturnType<typeof sourceCatalog>,
): { content: RequirementsContent; dropped: number } {
  let dropped = 0;
  const resolve = (sources: SourceRef[]): SourceRef[] => {
    const kept: SourceRef[] = [];
    for (const source of sources) {
      const entry = GROUNDED_TYPES.has(source.type) ? catalog.get(source.ref) : undefined;
      if (!entry) {
        dropped += 1;
        continue;
      }
      if (!kept.some((existing) => existing.ref === source.ref)) {
        kept.push({ type: entry.type, ref: source.ref, excerpt: excerpt(entry.text) });
      }
    }
    return kept;
  };

  const requirement = (item: Requirement): Requirement => {
    const sources = resolve(item.sources);
    return { ...item, id: "", sources, needsConfirmation: item.needsConfirmation || sources.length === 0 };
  };
  const assumption = (item: Assumption): Assumption => ({
    id: "",
    text: item.text,
    status: "NEEDS_CONFIRMATION",
    sources: resolve(item.sources),
  });

  return {
    content: {
      ...draft,
      functional: draft.functional.map(requirement),
      nonFunctional: draft.nonFunctional.map(requirement),
      assumptions: draft.assumptions.map(assumption),
    },
    dropped,
  };
}

const WORD = /[a-z0-9]{4,}/g;

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD) ?? []);
}

function overlaps(a: string, b: string): boolean {
  const left = words(a);
  for (const word of words(b)) if (left.has(word)) return true;
  return false;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const EXCLUSION = /\b(not included|excluded|exclude|out of scope|priced separately|separately|not part of)\b/i;
const NEED = /\b(must|need|needs|should|require|requires|required|want|wants)\b/i;

const NON_FUNCTIONAL: Array<{ pattern: RegExp; title: string; criterion: string }> = [
  {
    pattern: /\b(responsive|mobile)\b/i,
    title: "Responsive layout",
    criterion: "Pages render without horizontal scrolling on phone and desktop widths.",
  },
  {
    pattern: /\baccessib/i,
    title: "Accessibility",
    criterion: "Interactive elements are keyboard-operable and have accessible names.",
  },
  {
    pattern: /\b(secure|security)\b/i,
    title: "Security",
    criterion: "Security expectations named in the brief are reviewed with the Client before delivery.",
  },
  {
    pattern: /\b(performance|fast|speed)\b/i,
    title: "Performance",
    criterion: "Performance expectations named in the brief are measured and reported at delivery.",
  },
];

/**
 * Deterministic draft built only from the grounding records. It is what runs
 * without an LLM key and it never needs the network, so the demo and the tests
 * are reproducible.
 */
export function heuristicRequirementsDraft(input: RequirementsGrounding): RequirementsContent {
  const catalog = sourceCatalog(input);
  const { brief, proposal } = input;

  const firstSentence = sentences(brief.description)[0] ?? brief.description;
  const objective = `${brief.title}: ${firstSentence}`.slice(0, 2000);

  const usedLineItems = new Set<number>();
  const functional: Requirement[] = brief.deliverables.map((deliverable, index) => {
    const sources = [cite(catalog, `brief.deliverables[${index}]`)];
    const matched = proposal.lineItems.findIndex((item) => overlaps(item.description, deliverable));
    if (matched >= 0) {
      usedLineItems.add(matched);
      sources.push(cite(catalog, `proposal.lineItems[${matched}]`));
    }
    return {
      id: "",
      title: deliverable,
      description: matched >= 0 ? `Proposal line item: ${proposal.lineItems[matched].description}` : "",
      priority: "MUST",
      acceptanceCriteria: [`${deliverable} is delivered for review and approved by the Client.`],
      sources,
      needsConfirmation: false,
    };
  });

  // Proposal scope the brief never asked for is a question, not a requirement.
  proposal.lineItems.forEach((item, index) => {
    if (usedLineItems.has(index)) return;
    functional.push({
      id: "",
      title: item.description,
      description: "Offered in the proposal but not listed in the brief's deliverables.",
      priority: "SHOULD",
      acceptanceCriteria: [`${item.description} is delivered for review and approved by the Client.`],
      sources: [cite(catalog, `proposal.lineItems[${index}]`)],
      needsConfirmation: true,
    });
  });

  for (const message of input.messages) {
    for (const sentence of sentences(message.content)) {
      if (!NEED.test(sentence) || EXCLUSION.test(sentence)) continue;
      functional.push({
        id: "",
        title: excerpt(sentence, 120),
        description: `Raised by the ${message.authorRole === "CLIENT" ? "Client" : "Freelancer"} during discovery.`,
        priority: "SHOULD",
        acceptanceCriteria: ["The behaviour described in discovery is demonstrated to the Client."],
        sources: [{ ...cite(catalog, `message:${message.id}`), excerpt: excerpt(sentence) }],
        needsConfirmation: false,
      });
    }
  }

  const nonFunctional: Requirement[] = NON_FUNCTIONAL.filter((rule) => rule.pattern.test(brief.description)).map(
    (rule) => ({
      id: "",
      title: rule.title,
      description: "",
      priority: "SHOULD",
      acceptanceCriteria: [rule.criterion],
      sources: [cite(catalog, "brief.description")],
      needsConfirmation: false,
    }),
  );

  const outOfScope = [
    ...sentences(brief.description).filter((s) => EXCLUSION.test(s)),
    ...sentences(proposal.notes).filter((s) => EXCLUSION.test(s)),
  ];

  const assumptions: Assumption[] = [];
  const proposedEnd = new Date(input.selectedAt.getTime() + proposal.timelineDays * 86_400_000);
  assumptions.push({
    id: "",
    text:
      proposedEnd > brief.targetDate
        ? `Delivery takes ${proposal.timelineDays} days as proposed, which ends after the brief's target date of ${isoDate(brief.targetDate)}. Confirm which date applies.`
        : `Delivery takes ${proposal.timelineDays} days from agreement activation, as proposed.`,
    status: "NEEDS_CONFIRMATION",
    sources: [cite(catalog, "proposal.timelineDays"), cite(catalog, "brief.targetDate")],
  });
  if (proposal.total < brief.budgetMin || proposal.total > brief.budgetMax) {
    assumptions.push({
      id: "",
      text: `The proposed total of ${proposal.total} USD is outside the brief budget of ${brief.budgetMin}–${brief.budgetMax} USD. Confirm the commercial basis.`,
      status: "NEEDS_CONFIRMATION",
      sources: [cite(catalog, "proposal.total"), cite(catalog, "brief.budget")],
    });
  }
  if (input.messages.length === 0) {
    assumptions.push({
      id: "",
      text: "No discovery discussion has been recorded, so these requirements come from the brief and proposal only.",
      status: "NEEDS_CONFIRMATION",
      sources: [cite(catalog, "brief.description")],
    });
  }

  const draft: RequirementsContent = {
    objective,
    stakeholders: ["Client (brief owner)", "Freelancer (selected proposal)"],
    functional,
    nonFunctional,
    outOfScope,
    assumptions,
    constraints: [
      `Target completion date: ${isoDate(brief.targetDate)}.`,
      `Brief budget: ${brief.budgetMin}–${brief.budgetMax} USD.`,
    ],
    successMeasures: [
      "Every functional requirement is approved by the Client against its acceptance criteria.",
      `The project completes by ${isoDate(brief.targetDate)} or a date both parties confirm.`,
    ],
  };
  return enforceProvenance(draft, catalog).content;
}

const SYSTEM_PROMPT = [
  "You are the PactFlow requirements assistant.",
  "You draft a compact requirements brief (BRD) for a client and the freelancer they selected.",
  "Use ONLY the numbered sources you are given: the client's brief, the accepted proposal and the discovery messages.",
  "Every requirement and assumption must cite one or more sources by their exact ref string.",
  "Never invent requirements, costs, deadlines, stakeholders or technical constraints that no source states.",
  "Anything the sources imply but do not state goes into assumptions, or is a requirement with needsConfirmation true.",
  "Proposal scope that the brief did not ask for must have needsConfirmation true.",
  "Each functional requirement needs observable acceptance criteria drawn from the sources.",
  "You never approve anything: both parties review and approve the brief.",
].join(" ");

function buildPrompt(input: RequirementsGrounding, catalog: ReturnType<typeof sourceCatalog>): string {
  const lines = [...catalog.entries()].map(([ref, entry]) => `- [${ref}] (${entry.type}) ${entry.text}`);
  return [
    "Sources:",
    ...lines,
    `Proposal selected on: ${isoDate(input.selectedAt)}`,
    'Respond with JSON: { "objective": string, "stakeholders": string[], "functional": [{ "title", "description", "priority": "MUST"|"SHOULD"|"COULD", "acceptanceCriteria": string[], "sources": [{ "type", "ref" }], "needsConfirmation": boolean }], "nonFunctional": [same shape], "outOfScope": string[], "assumptions": [{ "text", "sources": [{ "type", "ref" }] }], "constraints": string[], "successMeasures": string[] }.',
  ].join("\n");
}

export const REQUIREMENTS_DRAFT_FAILED_NOTICE =
  "The AI draft could not be produced. Start from the brief and proposal manually.";

/** Produces a reviewable draft; never saves it. */
export async function generateRequirementsDraft(input: RequirementsGrounding): Promise<RequirementsDraftOutcome> {
  const catalog = sourceCatalog(input);
  const engine = isRealLLMEnabled() ? "llm" : "heuristic";
  try {
    const raw = await callLLMWithTimeout<RequirementsContent>({
      label: "requirements-draft",
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input, catalog),
      // Defaults make the input type looser than the output; the parsed value is the output.
      schema: RequirementsContentSchema as unknown as ZodSchema<RequirementsContent>,
      timeoutMs: AI_TIMEOUTS.quotation,
      localFallback: () => heuristicRequirementsDraft(input),
    });
    const { content, dropped } = enforceProvenance(raw, catalog);
    return {
      generated: true,
      content,
      engine,
      notice:
        dropped > 0
          ? `${dropped} source reference${dropped === 1 ? "" : "s"} did not match a real record and ${dropped === 1 ? "was" : "were"} removed. Items left without a source are marked "needs confirmation".`
          : null,
      droppedSources: dropped,
    };
  } catch (error) {
    const failure =
      error instanceof AITimeoutError ? "TIMEOUT" : error instanceof AIValidationError ? "VALIDATION" : "UNKNOWN";
    console.error("[ai] requirements draft failed", {
      failure,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { generated: false, content: null, engine, notice: REQUIREMENTS_DRAFT_FAILED_NOTICE, droppedSources: 0 };
  }
}

import type { ZodSchema } from "zod";
import { env, isRealLLMEnabled } from "@/lib/env";

export class AITimeoutError extends Error {
  constructor(public readonly label: string, public readonly timeoutMs: number) {
    super(`AI call "${label}" exceeded ${timeoutMs}ms`);
    this.name = "AITimeoutError";
  }
}

export class AIValidationError extends Error {
  constructor(public readonly label: string, public readonly detail: string) {
    super(`AI output for "${label}" failed schema validation: ${detail}`);
    this.name = "AIValidationError";
  }
}

export interface LLMCallOptions<T> {
  label: string;
  system: string;
  prompt: string;
  schema: ZodSchema<T>;
  timeoutMs: number;
  /**
   * Deterministic, grounded generator used when no LLM credentials are
   * configured (or as the fallback when the remote call fails). It must return
   * data derived only from the real records passed in the prompt.
   */
  localFallback: () => T;
}

/**
 * Requirement 4.2/8.4/11.2/21.1 — every AI call is bounded by a deadline and its
 * output is schema-validated. `AITimeoutError` and `AIValidationError` are
 * propagated so callers can apply the documented fallback behaviour.
 */
export async function callLLMWithTimeout<T>(options: LLMCallOptions<T>): Promise<T> {
  const { label, schema, timeoutMs, localFallback } = options;

  if (!isRealLLMEnabled()) {
    // Deterministic engine: no network, identical behaviour on every run.
    const value = localFallback();
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new AIValidationError(label, parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    return parsed.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.llmBaseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.llmApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.llmModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${options.system}\nRespond with a single JSON object only.` },
          { role: "user", content: options.prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new AIValidationError(label, `LLM HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new AIValidationError(label, "Empty completion");

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new AIValidationError(label, "Completion was not valid JSON");
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AIValidationError(label, parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AITimeoutError(label, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const AI_TIMEOUTS = {
  quotation: 30_000,
  comparison: 30_000,
  summary: 30_000,
  scopeClassification: 20_000,
} as const;

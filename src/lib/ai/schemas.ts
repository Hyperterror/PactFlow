import { z } from "zod";

/**
 * Every AI output shape is a Zod schema. Nothing produced by the AI Engine is
 * stored or returned without passing through one of these (design.md §5).
 */

export const AiLineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  suggestedPrice: z.number().positive().max(999_999_999.99),
  pricingConfidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  priceRangeMin: z.number().min(0),
  priceRangeMax: z.number().min(0),
  rationale: z.string().min(10).max(1000),
  marketBenchmarkSource: z.string().max(300).optional(),
  insufficientData: z.boolean().optional(),
});

export type AiLineItem = z.infer<typeof AiLineItemSchema>;

export const QuotationDraftSchema = z.object({
  lineItems: z.array(AiLineItemSchema).min(1),
  timelineDays: z.number().int().positive().max(3650),
  notes: z.string().min(1).max(5000),
  briefReferences: z.array(z.string()).min(1),
});

export type QuotationDraft = z.infer<typeof QuotationDraftSchema>;

export const PricingRecommendationSchema = z.object({
  recommendedPrice: z.number().positive().optional(),
  priceRangeMin: z.number().min(0).optional(),
  priceRangeMax: z.number().min(0).optional(),
  pricingConfidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  rationale: z.string().min(10).max(1000),
  basis: z.enum(["BRIEF_BUDGET", "HISTORY", "MARKET_BENCHMARK"]),
  marketBenchmarkSource: z.string().max(300).optional(),
  insufficientData: z.boolean(),
});

export type PricingRecommendation = z.infer<typeof PricingRecommendationSchema>;

export const ScopeClassificationSchema = z.object({
  label: z.enum(["INCLUDED", "OUTSIDE_SCOPE", "AMBIGUOUS"]),
  rationale: z.string().min(50, "Rationale must be at least 50 characters.").max(1000),
});

export type ScopeClassification = z.infer<typeof ScopeClassificationSchema>;

export const ComparisonSummarySchema = z.object({
  summary: z.string().min(1).max(4000),
  keyDifferences: z
    .array(
      z.object({
        attribute: z.string().min(1).max(200),
        comparison: z.string().min(1).max(1000),
      }),
    )
    .min(1),
  groundedQuotationIds: z.array(z.string()).min(1),
});

export type ComparisonSummary = z.infer<typeof ComparisonSummarySchema>;

export const CollaborationSummarySchema = z.object({
  summary: z.string().min(1).max(6000),
  statements: z
    .array(
      z.object({
        text: z.string().min(1).max(1000),
        sourceType: z.enum(["AGREEMENT", "DELIVERABLE", "WORKING_PREFERENCE"]),
        sourceId: z.string().min(1),
      }),
    )
    .min(1),
});

export type CollaborationSummary = z.infer<typeof CollaborationSummarySchema>;

import { describe, expect, it } from "vitest";
import {
  AGREEMENT_TRANSITIONS,
  DELIVERABLE_TRANSITIONS,
  MILESTONE_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  QUOTATION_TRANSITIONS,
  assertTransition,
  canTransition,
} from "@/lib/state";
import { ConflictError } from "@/lib/errors";

describe("status transition tables", () => {
  it("lets a draft quotation be submitted but never edited once accepted", () => {
    expect(canTransition(QUOTATION_TRANSITIONS, "AI_DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransition(QUOTATION_TRANSITIONS, "SUBMITTED", "ACCEPTED")).toBe(true);
    expect(canTransition(QUOTATION_TRANSITIONS, "ACCEPTED", "SUBMITTED")).toBe(false);
    expect(canTransition(QUOTATION_TRANSITIONS, "REJECTED", "ACCEPTED")).toBe(false);
  });

  it("treats the terminal states of every table as terminal", () => {
    expect(QUOTATION_TRANSITIONS.ACCEPTED).toEqual([]);
    expect(QUOTATION_TRANSITIONS.REJECTED).toEqual([]);
    expect(QUOTATION_TRANSITIONS.WITHDRAWN).toEqual([]);
    expect(PAYMENT_TRANSITIONS.CAPTURED).toEqual([]);
    expect(DELIVERABLE_TRANSITIONS.APPROVED).toEqual([]);
    expect(AGREEMENT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("keeps delivery and payment gating independent", () => {
    // A milestone may be approved for payment without the deliverable having
    // been approved, and vice versa: the two tables are not derived from one another.
    expect(canTransition(MILESTONE_TRANSITIONS, "DELIVERED", "APPROVED")).toBe(true);
    expect(canTransition(DELIVERABLE_TRANSITIONS, "REVISION_REQUESTED", "APPROVED")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "PENDING", "CAPTURED")).toBe(true);
    // ... but a captured payment can never return to PENDING or be re-captured.
    expect(canTransition(PAYMENT_TRANSITIONS, "CAPTURED", "PENDING")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "CAPTURED", "CAPTURED")).toBe(false);
  });

  it("never allows a self-transition", () => {
    const tables = [
      QUOTATION_TRANSITIONS,
      AGREEMENT_TRANSITIONS,
      MILESTONE_TRANSITIONS,
      DELIVERABLE_TRANSITIONS,
      PAYMENT_TRANSITIONS,
    ] as Array<Record<string, string[]>>;

    for (const table of tables) {
      for (const [from, allowed] of Object.entries(table)) {
        expect(allowed, `${from} should not transition to itself`).not.toContain(from);
      }
    }
  });

  it("reports the offending state when a transition is rejected", () => {
    let thrown: unknown;
    try {
      assertTransition(
        PAYMENT_TRANSITIONS,
        "CAPTURED",
        "PENDING",
        "PAYMENT_ALREADY_CAPTURED",
        "A captured payment cannot be re-opened.",
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictError);
    const conflict = thrown as ConflictError;
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe("STATE_CONFLICT");
    expect(conflict.currentState).toBe("CAPTURED");
  });

  it("does not mutate the transition table when asserting", () => {
    const before = MILESTONE_TRANSITIONS.DELIVERED.slice();
    assertTransition(MILESTONE_TRANSITIONS, "DELIVERED", "APPROVED", "X", "x");
    expect(MILESTONE_TRANSITIONS.DELIVERED).toEqual(before);
  });
});

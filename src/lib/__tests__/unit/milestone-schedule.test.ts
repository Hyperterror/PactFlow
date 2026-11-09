import { describe, expect, it } from "vitest";
import { buildSchedule, scheduleDependencies, sortByDueDate, type ScheduleMilestone } from "@/lib/milestones/schedule";

/**
 * Requirement 13.6 — the Milestone Gantt view.
 *
 * The chart is only trustworthy if its rows are. These tests pin the two facts
 * that matter: milestones appear in due-date order, and every bar ends exactly
 * on the contractual deadline rather than on a date the view invented.
 */

const usd = (amount: number) => `$${amount.toFixed(2)}`;

function milestone(overrides: Partial<ScheduleMilestone> & { id: string; dueDate: Date }): ScheduleMilestone {
  return {
    name: `Milestone ${overrides.id}`,
    description: "A described deliverable.",
    paymentAmount: 1000,
    status: "PENDING",
    paymentStatus: null,
    overdue: false,
    ...overrides,
  };
}

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

describe("milestone schedule", () => {
  it("orders milestones by due date regardless of input order", () => {
    const input = [
      milestone({ id: "c", dueDate: day("2026-03-20") }),
      milestone({ id: "a", dueDate: day("2026-03-05") }),
      milestone({ id: "b", dueDate: day("2026-03-12") }),
    ];

    expect(sortByDueDate(input).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a due-date tie deterministically", () => {
    const same = day("2026-04-01");
    const input = [
      milestone({ id: "z", dueDate: same }),
      milestone({ id: "a", dueDate: same }),
    ];

    expect(sortByDueDate(input).map((item) => item.id)).toEqual(["a", "z"]);
    expect(sortByDueDate([...input].reverse()).map((item) => item.id)).toEqual(["a", "z"]);
  });

  it("ends every bar on the milestone's due date", () => {
    const tasks = buildSchedule(
      [
        milestone({ id: "one", dueDate: day("2026-05-10") }),
        milestone({ id: "two", dueDate: day("2026-06-01") }),
      ],
      usd,
    );

    expect(tasks.map((task) => task.endDate)).toEqual([
      day("2026-05-10").toISOString(),
      day("2026-06-01").toISOString(),
    ]);
  });

  it("never starts a bar before the previous milestone is due", () => {
    const tasks = buildSchedule(
      [
        milestone({ id: "one", dueDate: day("2026-05-10") }),
        milestone({ id: "two", dueDate: day("2026-05-11") }),
        milestone({ id: "three", dueDate: day("2026-06-20") }),
      ],
      usd,
    );

    // Back-to-back deadlines: order wins over the minimum bar length.
    expect(new Date(tasks[1]!.startDate).getTime()).toBeGreaterThan(
      new Date(tasks[0]!.endDate).getTime(),
    );
    // A wide gap: the bar starts the day after the previous deadline.
    expect(new Date(tasks[2]!.startDate).getTime()).toBe(
      new Date(tasks[1]!.endDate).getTime() + 86_400_000,
    );
  });

  it("keeps a one-day milestone visible without moving its deadline", () => {
    const tasks = buildSchedule([milestone({ id: "short", dueDate: day("2026-05-10") })], usd);
    const start = new Date(tasks[0]!.startDate).getTime();
    const end = new Date(tasks[0]!.endDate).getTime();

    expect(end - start).toBeGreaterThanOrEqual(3 * 86_400_000);
    expect(tasks[0]!.endDate).toBe(day("2026-05-10").toISOString());
  });

  it("carries the amount and status into the row, using the caller's formatting", () => {
    const [task] = buildSchedule(
      [
        milestone({
          id: "paid",
          dueDate: day("2026-05-10"),
          paymentAmount: 2500,
          status: "APPROVED",
          paymentStatus: "CAPTURED",
          overdue: false,
        }),
      ],
      usd,
    );

    expect(task!.amountLabel).toBe("$2500.00");
    expect(task!.note).toContain("$2500.00");
    expect(task!.note).toContain("approved");
    expect(task!.note).toContain("Payment captured");
  });

  it("flags a late milestone in its tooltip", () => {
    const [task] = buildSchedule(
      [milestone({ id: "late", dueDate: day("2026-01-05"), overdue: true })],
      usd,
    );

    expect(task!.note).toContain("Overdue");
  });

  it("chains the bars in order and leaves the first one unlinked", () => {
    const tasks = buildSchedule(
      [
        milestone({ id: "a", dueDate: day("2026-05-10") }),
        milestone({ id: "b", dueDate: day("2026-06-10") }),
        milestone({ id: "c", dueDate: day("2026-07-10") }),
      ],
      usd,
    );

    expect(scheduleDependencies(tasks)).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
  });

  it("returns nothing for an agreement with no milestones", () => {
    expect(buildSchedule([], usd)).toEqual([]);
    expect(scheduleDependencies([])).toEqual([]);
  });
});
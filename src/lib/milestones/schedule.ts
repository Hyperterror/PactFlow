/**
 * Requirement 13.6 — the Milestone Gantt view.
 *
 * The Prisma model stores a milestone's `dueDate` but not a start date or a
 * duration: a milestone is a payment gate with a deadline, not a work package
 * with booked time. A Gantt bar nevertheless needs both ends, so the schedule is
 * derived rather than invented:
 *
 * - a milestone ends on its `dueDate`;
 * - it starts the day after the previous milestone is due, so the row order on
 *   the chart is the order the milestones are worked;
 * - the first bar is given a short lead-in so it does not collapse to a point.
 *
 * Nothing here is written back to the database. The chart is a read-only view of
 * records that are already persisted, so the Gantt cannot drift from the
 * Agreement it represents.
 */

/** One milestone as the Delivery index already loads it. */
export interface ScheduleMilestone {
  id: string;
  name: string;
  description: string;
  dueDate: Date;
  paymentAmount: number;
  status: string;
  paymentStatus: string | null;
  overdue: boolean;
}

export interface ScheduleTask {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  paymentStatus: string | null;
  amountLabel: string;
  /** Tooltip body. Plain text: it is shown as text, never parsed as markup. */
  note: string;
}

const DAY_MS = 86_400_000;

/** Shortest bar worth drawing, so a one-day milestone stays visible. */
const MIN_BAR_DAYS = 3;

/** Further back than this, the bar stops pretending to know when work began. */
const MAX_BAR_DAYS = 28;

function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

/**
 * Milestones in the order they are worked: due date first, then creation order.
 * This mirrors `listMilestonesForUser`, so the chart and the list cannot
 * disagree about which milestone comes first.
 */
export function sortByDueDate(milestones: ScheduleMilestone[]): ScheduleMilestone[] {
  return [...milestones].sort((a, b) => {
    const delta = a.dueDate.getTime() - b.dueDate.getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

/**
 * Builds the Gantt rows. `formatAmount` is injected so the caller keeps control
 * of currency formatting — the same milestone must not read as one figure in the
 * list and another on the chart.
 */
export function buildSchedule(
  milestones: ScheduleMilestone[],
  formatAmount: (amount: number) => string,
): ScheduleTask[] {
  const ordered = sortByDueDate(milestones);
  let previousEnd: Date | null = null;

  return ordered.map((milestone) => {
    const end = startOfDay(milestone.dueDate);
    // Two rules, in this order:
    //   1. a bar never starts before the previous milestone is due, so the chart
    //      cannot imply work began during someone else's phase;
    //   2. a bar is never shorter than MIN_BAR_DAYS, so a one-day milestone stays
    //      visible.
    // When two deadlines are closer together than that, rule 1 wins — order is
    // the fact that matters — and the earlier bar simply runs into the next.
    const latestStart = addDays(end, -MIN_BAR_DAYS);
    const start = previousEnd
      ? addDays(previousEnd, 1)
      : new Date(Math.max(latestStart.getTime(), addDays(end, -MAX_BAR_DAYS).getTime()));
    previousEnd = end;

    const amount = formatAmount(milestone.paymentAmount);
    const payment = milestone.paymentStatus ? ` · Payment ${milestone.paymentStatus.toLowerCase()}` : "";
    const deadline = milestone.overdue ? " · Overdue" : "";

    return {
      id: milestone.id,
      name: milestone.name,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status: milestone.status,
      paymentStatus: milestone.paymentStatus,
      amountLabel: amount,
      note: `${amount} · Due ${end.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })} · ${milestone.status.toLowerCase()}${payment}${deadline}\n${milestone.description}`,
    };
  });
}

/** The dependency chain, expressed separately so a row can move without it. */
export function scheduleDependencies(tasks: ScheduleTask[]): Array<{ from: string; to: string }> {
  const links: Array<{ from: string; to: string }> = [];
  for (let index = 1; index < tasks.length; index += 1) {
    links.push({ from: tasks[index - 1]!.id, to: tasks[index]!.id });
  }
  return links;
}

import { afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Tables in child-first order. SQLite enforces foreign keys, so the reset walks
 * the graph from the leaves up to `User` rather than switching the pragma off
 * (a `PRAGMA` issued through Prisma only affects one pooled connection).
 */
const TABLES_CHILD_FIRST = [
  "ComparisonAnnotation",
  "ComparisonItem",
  "ComparisonWorkspace",
  "SignedUrlEvent",
  "RevisionRequest",
  "Payment",
  "Deliverable",
  "Milestone",
  "WorkingPreference",
  "CollaborationSummary",
  "ProjectTemplate",
  "CollaborationHistory",
  "ChangeRequestVote",
  "ScopeLabelDispute",
  "ChangeRequest",
  "DiscussionMessage",
  "AgreementApproval",
  "AgreementVersion",
  "Agreement",
  "QuotationComment",
  "Quotation",
  "Invitation",
  "Brief",
  "AuditLog",
  "Notification",
  "WebhookEvent",
  "Session",
  "LoginAttempt",
  "User",
] as const;

/** Empties the test database so each property starts from a known state. */
export async function resetDatabase(): Promise<void> {
  for (const table of TABLES_CHILD_FIRST) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
}

/**
 * Release this file's connection when the file finishes.
 *
 * Every suite shares one SQLite file, and all of them run in a single process
 * with `fileParallelism: false`. A Prisma client left open keeps its connection
 * to that file alive after the file's tests are done, so the next file's
 * `resetDatabase()` competes with a writer it cannot see and the suite fails with
 * `database is locked` — the symptom only ever appears in a full run, never when
 * the file is executed on its own. Registering the hook here means only the
 * DB-backed suites pay the cost of importing `@prisma/client`; the pure unit
 * suites never load this module.
 */
afterAll(async () => {
  await prisma.$disconnect();
});

/** Counts rows without leaking a table name into every assertion. */
export async function countRows(table: (typeof TABLES_CHILD_FIRST)[number]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*) AS count FROM "${table}"`,
  );
  return Number(rows[0]?.count ?? 0);
}

export { prisma };

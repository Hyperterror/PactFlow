import { execSync } from "node:child_process";

/**
 * Recreates the throw-away test database from `prisma/schema.prisma` before the
 * suite runs.
 *
 * The integration properties drive the real domain modules, which talk to
 * Prisma, so they need a real schema. Building a throw-away database keeps
 * `prisma/dev.db` (the demo data) untouched and guarantees every run starts from
 * an empty schema.
 *
 * The file itself is chosen — and emptied — by `resolveTestDatabase`, which
 * `vitest.config.mts` also calls so the workers and this process agree on one
 * URL; the choice is handed over in `PACTFLOW_TEST_DATABASE_URL`.
 */
export default function globalSetup(): void {
  const url = process.env.PACTFLOW_TEST_DATABASE_URL ?? "file:./test.db";

  execSync("npx prisma db push --skip-generate", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

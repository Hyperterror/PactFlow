import { rmSync } from "node:fs";
import path from "node:path";

/** Name prefix of the run-specific fallback files. */
const FALLBACK_PREFIX = "test-run-";

/**
 * Deletes a file, reporting whether it is gone.
 *
 * `force` only suppresses "no such file"; Windows still refuses to delete an
 * SQLite file another handle has open, and that is not an error worth
 * propagating — the caller only needs to know whether the name is reusable.
 */
function remove(file: string): boolean {
  try {
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Picks the throw-away SQLite file the suites run against and empties it.
 *
 * `prisma/test.db` is the normal answer. It is gitignored, it sits next to
 * `schema.prisma` because Prisma resolves relative `file:` URLs against the
 * schema directory, and keeping it separate leaves the developer's
 * `prisma/dev.db` demo data untouched.
 *
 * A run that crashed, or an editor process still holding an engine handle, can
 * keep that file open — and Windows refuses to delete an open SQLite file
 * (`EPERM`), which would otherwise turn a dirty environment into "the whole
 * suite cannot start". The file only has to be empty, never to have a particular
 * name, so the fallback is a run-specific one and the run proceeds.
 *
 * The chosen URL has to reach both this process and every worker, so
 * `resolveTestDatabase` is called once from `vitest.config.mts`, which hands the
 * result on through `env` and `process.env` (see `global-setup.ts`).
 */
export function resolveTestDatabase(): { fileName: string; url: string } {
  const preferred = "test.db";
  const directory = path.resolve(process.cwd(), "prisma");
  const file = path.join(directory, preferred);

  // Delete the database and its journal independently: a journal some editor
  // still holds should not cost us the reusable `test.db`.
  if (remove(file) && remove(`${file}-journal`)) {
    return { fileName: preferred, url: `file:./${preferred}` };
  }

  // Never derive this name from the process id: Windows recycles ids eagerly, so
  // a new run can land on the very file the stranded process from an earlier run
  // is holding — which is exactly the collision that cannot be deleted.
  const fallback = `${FALLBACK_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.db`;
  return { fileName: fallback, url: `file:./${fallback}` };
}

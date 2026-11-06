import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolveTestDatabase } from "./src/lib/__tests__/test-database";

/**
 * The throw-away database the DB-backed suites run against. Resolved here rather
 * than in `global-setup.ts` so this process and every worker agree on one file;
 * the global setup reads the same URL back out of the environment.
 */
const testDatabase = resolveTestDatabase();
process.env.PACTFLOW_TEST_DATABASE_URL = testDatabase.url;

/**
 * Vitest runs the domain layer directly (no Next.js runtime), which is why the
 * domain modules are kept free of React imports. `tsconfigPaths` mirrors the
 * `@/*` alias so the tests import exactly what the app imports.
 *
 * The file is `.mts` because `package.json` has no `"type": "module"`: a plain
 * `vitest.config.ts` would be bundled as CommonJS and cannot `require` an
 * ESM-only plugin such as `vite-tsconfig-paths`.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  // The domain layer imports no CSS. Supplying an inline (empty) PostCSS config
  // stops Vite from loading `postcss.config.mjs`, whose Tailwind v4 plugin is
  // not understood by the PostCSS runner bundled with this Vite version.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    css: false,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e"],
    setupFiles: ["src/lib/__tests__/setup.ts"],
    // The property and integration suites exercise the real domain modules, so
    // they need the real database. They get their own throw-away SQLite file
    // (normally `prisma/test.db`) that `global-setup.ts` recreates from the
    // schema, which keeps the developer's `prisma/dev.db` untouched.
    globalSetup: ["src/lib/__tests__/global-setup.ts"],
    env: { DATABASE_URL: testDatabase.url },
    // SQLite serialises writers; the concurrency properties drive several
    // transactions at once, so give each test room rather than racing a timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The suites share one database file, so they must not run in parallel.
    fileParallelism: false,
    clearMocks: true,
  },
});

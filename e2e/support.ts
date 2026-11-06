import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the end-to-end suite.
 *
 * Every input is addressed by its `id` rather than by label text: the `Field`
 * component appends a required marker to some labels, and ids are what the
 * browser autofill and the tests should agree on anyway.
 */

export const DEMO_PASSWORD = "Password123!";

/** Accounts created by `prisma/seed.ts`. */
export const DEMO = {
  client: "client@pactflow.dev",
  freelancer: "freelancer@pactflow.dev",
  secondFreelancer: "grace@pactflow.dev",
  clientDisplayName: "Northwind Studio",
  freelancerDisplayName: "Ada Lovelace",
} as const;

/** Titles and names from the seed that the mid-project specs navigate by. */
export const SEED = {
  activeBriefTitle: "Marketing site rebuild",
  uploadMilestone: "Final QA and handover",
  reviewMilestone: "Pricing page",
} as const;

let sequence = 0;

/**
 * A fresh address for each run. The database is re-seeded before the suite, but
 * uniqueness keeps a re-run against a warm database from colliding.
 */
export function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}.${Date.now().toString(36)}${sequence}@e2e.pactflow.dev`;
}

export async function signIn(page: Page, email: string, password: string = DEMO_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/briefs$/);
}

export async function register(
  page: Page,
  input: { displayName: string; email: string; password?: string },
): Promise<void> {
  const password = input.password ?? DEMO_PASSWORD;
  await page.goto("/register");
  await page.locator("#displayName").fill(input.displayName);
  await page.locator("#email").fill(input.email);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/briefs$/);
}

/**
 * An independent signed-in browser. Two parties on the same agreement need two
 * sessions, and separate contexts keep their cookies from overwriting each other.
 */
export async function openSession(page: Page, email: string, password = DEMO_PASSWORD): Promise<Page> {
  const session = await page.context().browser()!.newContext();
  const tab = await session.newPage();
  await signIn(tab, email, password);
  return tab;
}

/** Registers a brand-new account inside its own browser context. */
export async function registerSession(
  page: Page,
  input: { displayName: string; email: string; password?: string },
): Promise<Page> {
  const session = await page.context().browser()!.newContext();
  const tab = await session.newPage();
  await register(tab, input);
  return tab;
}

/** The agreement id behind a milestone, reached the way a user reaches it. */
export async function openAgreementFromDelivery(page: Page, milestoneName: string): Promise<string> {
  await page.goto("/delivery");
  await page
    .getByRole("listitem")
    .filter({ hasText: milestoneName })
    .getByRole("link", { name: "Open room" })
    .click();
  await page.waitForURL(/\/delivery\/[^/]+$/);

  // `exact` keeps this off the sidebar's "Agreements" entry.
  await page.getByRole("link", { name: "Agreement", exact: true }).click();
  await page.waitForURL(/\/agreements\/[^/]+$/);
  const match = /\/agreements\/([^/?#]+)/.exec(page.url());
  expect(match).not.toBeNull();
  return match![1];
}

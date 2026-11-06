import { expect, test, type Page } from "@playwright/test";
import { DEMO, SEED, openAgreementFromDelivery, openSession, signIn } from "./support";

/**
 * Task 31.5 — a scope change is proposed, classified, voted on and only then
 * turned into a new agreement version.
 *
 * Requirements 10.x (discussion), 11.x (proposal + advisory classification) and
 * 12.x (dual vote → new version). Two sessions are needed because the vote is
 * per party: one approval must leave the agreement untouched.
 */

const PROPOSAL =
  "Please also add a fourth page: a blog with thirty migrated posts, tag archives " +
  "and an RSS feed. None of that is in the agreed scope, and it arrives after the " +
  "pricing page was already signed off.";

/**
 * The proposal card, addressed by its stable id: the discussion timeline repeats
 * the proposal text in its own list item, so a plain text match is ambiguous.
 */
function proposalCard(page: Page) {
  return page.locator("li[id^='proposal-']").filter({ hasText: "blog with thirty migrated posts" });
}

test.describe.configure({ mode: "serial" });

test("one approval leaves the agreement untouched", async ({ page }) => {
  await signIn(page, DEMO.client);
  const agreementId = await openAgreementFromDelivery(page, SEED.reviewMilestone);
  await page.goto(`/agreements/${agreementId}/discussion`);

  // ── 10.x: discussion ───────────────────────────────────────────────────
  const message = `Before the blog question, a status note ${Date.now().toString(36)}.`;
  await page.getByLabel("New message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(message)).toBeVisible({ timeout: 20_000 });

  // ── 11.x: propose, and let the engine classify it ──────────────────────
  await page.getByRole("button", { name: "Propose" }).click();
  await page.getByLabel("Proposal text").fill(PROPOSAL);
  await page.getByRole("button", { name: "Submit proposal" }).click();

  const proposal = proposalCard(page);
  await expect(proposal).toBeVisible({ timeout: 25_000 });

  // Requirement 11.x — the label is advisory and always one of three values,
  // and it always carries a rationale.
  await expect(proposal.getByText("AI classification (advisory):")).toBeVisible();
  await expect(
    proposal.getByText(/^(Included|Outside scope|Ambiguous)$/).first(),
  ).toBeVisible();

  // Requirement 12.x — one vote is recorded and changes nothing.
  await proposal.getByRole("button", { name: "Approve" }).click();
  await expect(proposal.getByRole("button", { name: "Retract my vote" })).toBeVisible({ timeout: 20_000 });
  await expect(proposal.getByText("Approve", { exact: true })).toHaveCount(1);
  await expect(proposal.getByText("Not voted", { exact: true })).toHaveCount(1);

  // The agreement is still on version 1 and still active.
  await page.goto(`/agreements/${agreementId}`);
  await expect(page.getByRole("button", { name: /Approve version/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Version 1" })).toBeVisible();
});

test("the second vote creates a new agreement version", async ({ page }) => {
  await signIn(page, DEMO.client);
  const agreementId = await openAgreementFromDelivery(page, SEED.reviewMilestone);

  const freelancer = await openSession(page, DEMO.freelancer);
  try {
    await freelancer.goto(`/agreements/${agreementId}/discussion`);
    const proposal = proposalCard(freelancer);
    await expect(proposal).toBeVisible();
    await expect(proposal.getByText("Not voted", { exact: true })).toHaveCount(1);

    await proposal.getByRole("button", { name: "Approve" }).click();

    // Both votes are now in and the proposal is closed to further voting.
    await expect(proposal.getByText("Approve", { exact: true })).toHaveCount(2, { timeout: 20_000 });
    await expect(proposal.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // ── 12.x: the approved change is a new version, never an edit ─────────
    await freelancer.goto(`/agreements/${agreementId}`);
    await expect(freelancer.getByRole("button", { name: "Approve version 2" })).toBeVisible({ timeout: 20_000 });
    await expect(freelancer.getByRole("heading", { name: "Version 2" })).toBeVisible();
  } finally {
    await freelancer.context().close();
  }
});

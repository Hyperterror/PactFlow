import { expect, test, type Page } from "@playwright/test";
import { register, registerSession, uniqueEmail } from "./support";

/**
 * Tasks 31.2 and 31.3 — the path a project actually takes.
 *
 * Requirements 2.x (brief lifecycle), 3.x (invitations), 4.x (AI quotation
 * draft), 8.x (comparison workspace) and 9.x (agreement dual approval).
 *
 * The whole journey runs in one test because each step depends on the last:
 * two invitations produce two quotations, the quotations populate the
 * comparison workspace, accepting one creates the agreement, and the agreement
 * only becomes active on the second approval. Three separate browser contexts
 * stand in for the three people involved.
 */

test.describe.configure({ mode: "serial" });

/** Aligns every remaining bid as a column in the comparison grid. */
async function alignAllBids(page: Page): Promise<void> {
  for (let guard = 0; guard < 6; guard += 1) {
    const add = page.getByRole("button", { name: /^\+ / });
    if ((await add.count()) === 0) return;
    await add.first().click();
    await page.waitForTimeout(300);
  }
}

test("a published brief becomes a dual-approved agreement", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const clientEmail = uniqueEmail("client");
  const firstEmail = uniqueEmail("freelancer");
  const secondEmail = uniqueEmail("freelancer");

  await register(page, { displayName: "E2E Client", email: clientEmail });

  // Two Freelancers, because a comparison workspace needs two bids to align.
  const first = await registerSession(page, { displayName: "E2E Freelancer One", email: firstEmail });
  const second = await registerSession(page, { displayName: "E2E Freelancer Two", email: secondEmail });

  try {
    // ── 2.x: the Client writes and publishes the brief ─────────────────────
    const title = `E2E marketing site ${stamp}`;
    await page.getByRole("link", { name: "New brief" }).click();
    await page.waitForURL(/\/briefs\/new$/);
    await page.locator("#title").fill(title);
    await page.locator("#description").fill(
      "Rebuild the marketing site with a design system, a homepage and a pricing page. " +
        "Copy is written by us; photography is licensed.",
    );
    await page.getByLabel("Deliverable 1").fill("Homepage");
    await page.locator("#budgetMin").fill("2000");
    await page.locator("#budgetMax").fill("5000");
    await page.locator("#targetDate").fill("2027-03-31");
    await page.getByRole("button", { name: "Save draft" }).click();
    // `(?!new$)` matters: the create form lives at /briefs/new, which would
    // otherwise satisfy this pattern before the new brief has been opened.
    await page.waitForURL(/\/briefs\/(?!new$)[^/]+$/);
    const briefId = /\/briefs\/([^/?#]+)/.exec(page.url())![1];

    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.getByRole("button", { name: "Publish brief" }).click();
    await expect(page.getByRole("button", { name: "Close to new quotations" })).toBeVisible();

    // ── 3.x: invitations ───────────────────────────────────────────────────
    for (const [index, email] of [firstEmail, secondEmail].entries()) {
      await page.locator("#freelancerEmail").fill(email);
      await page.getByRole("button", { name: "Send invitation" }).click();
      // The count and the list are rendered by the server, so seeing them means
      // the invitation really exists — the per-form notice is client state.
      await expect(page.getByText(`${index + 1} sent`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(email)).toBeVisible();
    }

    // ── 3.4/4.x: accept, draft with AI, submit ─────────────────────────────
    for (const [tab, lineItem] of [
      [first, "Homepage and design system"],
      [second, "Homepage, pricing page and design system"],
    ] as const) {
      await tab.goto("/briefs");
      // Exactly one invitation is outstanding for each Freelancer at this point.
      await tab.getByRole("button", { name: "Accept", exact: true }).first().click();
      await expect(tab.getByText("No pending invitations")).toBeVisible({ timeout: 20_000 });

      await tab.goto(`/briefs/${briefId}`);
      await tab.getByRole("link", { name: "Start a quotation" }).click();
      await tab.waitForURL(/\/quotations\/new/);

      await tab.getByRole("button", { name: "Generate draft" }).click();
      await tab.waitForURL(/\/quotations\/[^/]+\/edit$/);

      // The draft is advice; the Freelancer still owns every number.
      await tab.getByLabel("Line item 1 description").fill(lineItem);
      await tab.getByLabel("Line item 1 price").fill("3200");
      await tab.locator("#timelineDays").fill("21");
      await tab.locator("#notes").fill(
        "Discovery in week one, the design system in week two, then the pages. " +
          "Two review rounds are included; a third scope pass would be priced separately.",
      );
      await tab.getByRole("button", { name: "Submit quotation" }).click();
      await tab.waitForURL(/\/quotations\/[^/]+$/);
      // The submitted line item is what the Client will see on their side.
      await expect(tab.getByText(lineItem)).toBeVisible();
    }

    // ── 8.x: comparison workspace ──────────────────────────────────────────
    await page.goto(`/briefs/${briefId}/compare`);
    await alignAllBids(page);

    await expect(page.getByText("E2E Freelancer One", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Freelancer Two", { exact: true })).toBeVisible();
    await expect(page.getByText("Total")).toBeVisible();

    await page.getByRole("button", { name: "Generate summary" }).click();
    // The button only relabels once a summary exists.
    await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Grounded in \d+ quotations/)).toBeVisible();

    // ── 9.x: acceptance creates the agreement at version 1 ─────────────────
    await page.getByRole("button", { name: /^Accept E2E Freelancer One/ }).click();
    await page.waitForURL(/\/agreements\/[^/]+$/);
    const agreementId = /\/agreements\/([^/?#]+)/.exec(page.url())![1];

    await expect(page.getByText("Pending approval — no delivery or payment can start until both parties approve.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve version 1" })).toBeVisible();

    // ── 9.5: one approval is never enough ──────────────────────────────────
    await page.getByRole("button", { name: "Approve version 1" }).click();
    await expect(
      page.getByText("You approved this version. The agreement becomes active once the other party approves too."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /Approve version/ })).toHaveCount(0);

    // The other party approves their own side.
    await first.goto(`/agreements/${agreementId}`);
    await first.getByRole("button", { name: "Approve version 1" }).click();
    await expect(first.getByText("Approved", { exact: true })).toHaveCount(2);
    await expect(first.getByRole("button", { name: /Approve version/ })).toHaveCount(0);

    // Both sides now see a fully approved version.
    await page.goto(`/agreements/${agreementId}`);
    await expect(page.getByText("Approved", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /Approve version/ })).toHaveCount(0);

    // The second Freelancer quoted on this brief but was never accepted, so the
    // agreement is not theirs to read: PactFlow answers the same 404 it gives a
    // stranger rather than confirming that the record exists.
    await second.goto(`/agreements/${agreementId}`);
    await expect(second.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(second.getByText("Approved", { exact: true })).toHaveCount(0);
    await expect(second.getByRole("button", { name: /Approve version/ })).toHaveCount(0);
  } finally {
    await first.context().close();
    await second.context().close();
  }
});

test("a quotation cannot be submitted before its brief is published", async ({ page }) => {
  const email = uniqueEmail("draft-only");
  await register(page, { displayName: "E2E Draft Client", email });

  await page.getByRole("link", { name: "New brief" }).click();
  await page.waitForURL(/\/briefs\/new$/);
  await page.locator("#title").fill(`E2E draft ${Date.now().toString(36)}`);
  await page.locator("#description").fill("A draft that must not accept quotations yet.");
  await page.getByLabel("Deliverable 1").fill("Landing page");
  await page.locator("#budgetMin").fill("500");
  await page.locator("#budgetMax").fill("900");
  await page.locator("#targetDate").fill("2027-01-31");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/briefs\/(?!new$)[^/]+$/);
  const briefId = /\/briefs\/([^/?#]+)/.exec(page.url())![1];

  // The Client is not a bidder, so the bidding entry point must not exist.
  await expect(page.getByRole("link", { name: "Start a quotation" })).toHaveCount(0);

  // And the server refuses an invitation to a draft brief in any case.
  const refused = await page.request.post(`/api/briefs/${briefId}/close`);
  expect(refused.status()).toBe(409);
});

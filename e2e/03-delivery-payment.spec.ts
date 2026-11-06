import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DEMO, SEED, signIn } from "./support";

/**
 * Task 31.4 — upload, review, pay, download.
 *
 * Requirements 14.x (upload), 15.x (preview), 16.x (PayPal checkout), 17.x
 * (webhook/capture), 18.x (payment) and 19.x (Signed_URL release).
 *
 * The suite starts from the seeded active agreement because a milestone can only
 * be created once an agreement is active and the UI deliberately offers no way
 * to skip that. Two milestones are used: one still pending, so the Freelancer
 * has something to upload against, and one already delivered, which is where the
 * Client approves and pays.
 */

/** A real, single-page PDF — the upload endpoint sniffs the bytes, not the name. */
async function buildPdf(title: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 56, y: 780, size: 18, font });
  page.drawText("PactFlow end-to-end fixture", { x: 56, y: 754, size: 10, font });
  return Buffer.from(await pdf.save());
}

async function openRoom(page: Page, milestoneName: string): Promise<void> {
  await page.goto("/delivery");
  await page
    .getByRole("listitem")
    .filter({ hasText: milestoneName })
    .getByRole("link", { name: "Open room" })
    .click();
  await page.waitForURL(/\/delivery\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: milestoneName })).toBeVisible();
}

test("the Freelancer uploads a PDF and marks the milestone delivered", async ({ page }) => {
  await signIn(page, DEMO.freelancer);
  await openRoom(page, SEED.uploadMilestone);

  // Nothing uploaded yet on the milestone the seed deliberately left pending.
  await expect(page.getByText("No upload yet")).toBeVisible();

  const original = await buildPdf("Final QA and handover");
  await page.getByLabel("Deliverable PDF").setInputFiles({
    name: "final-qa.pdf",
    mimeType: "application/pdf",
    buffer: original,
  });
  await page.getByRole("button", { name: "Upload PDF" }).click();

  // Requirement 14.x — the upload is stored, hashed and versioned. The header
  // reads from the server, so seeing it means the round trip really landed.
  await expect(page.getByText("Latest version 1")).toBeVisible({ timeout: 20_000 });

  // ── 15.x: the preview is a watermarked derivative, not the upload ────────
  // Same bytes back would mean the preview endpoint is serving the original, so
  // the only assertion worth making is that it is a PDF that differs from what
  // was handed in.
  const previewHref = await page.getByRole("link", { name: "Open watermarked preview" }).getAttribute("href");
  expect(previewHref).toContain("/preview");
  const preview = await page.request.get(previewHref!);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toContain("application/pdf");
  const previewBytes = await preview.body();
  expect(previewBytes.subarray(0, 4).toString()).toBe("%PDF");
  expect(previewBytes.equals(original)).toBe(false);

  // Requirement 13.3 — delivery is only possible once the file exists.
  await page.getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.getByRole("button", { name: "Mark delivered" })).toBeDisabled({ timeout: 20_000 });

  // Requirement 19.2 — even the Freelancer cannot reach the original before the
  // payment is captured; only the watermarked preview is offered.
  await expect(page.getByRole("button", { name: /Download original/ })).toHaveCount(0);
  await expect(page.getByText("Open watermarked preview").or(page.getByText("Open preview"))).toBeVisible();
});

test("the Client approves, pays through the mock checkout and downloads the signed original", async ({ page }) => {
  await signIn(page, DEMO.client);
  await openRoom(page, SEED.reviewMilestone);

  // Requirement 19.2 — locked until the capture is confirmed.
  await expect(page.getByRole("button", { name: /Download original/ })).toHaveCount(0);
  await expect(
    page.getByText(
      "You can review the watermarked preview now. The original file and its signed download link are released only after the payment is captured.",
    ),
  ).toBeVisible();

  // ── 15.x: approve the work, then the milestone ──────────────────────────
  await page.getByRole("button", { name: "Approve work" }).click();
  await expect(page.getByRole("button", { name: "Approve work" })).toHaveCount(0, { timeout: 20_000 });

  // Requirement 13.3 / 16.1 — the seed left an uncaptured order on this
  // milestone, but nothing may be payable until the Client approves it.
  await expect(page.getByText("Payment becomes available once the milestone is approved.")).toBeVisible();
  await expect(page.getByRole("button", { name: /PayPal/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Approve milestone" }).click();
  // Now the control resumes that same order rather than opening a new one.
  await expect(page.getByRole("button", { name: "Continue to PayPal" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Approve milestone" })).toHaveCount(0);

  // ── 16.x: hand off to the PayPal approve screen ─────────────────────────
  await page.getByRole("button", { name: "Continue to PayPal" }).click();
  await page.waitForURL(/\/payments\/mock-approve\?token=/);
  await expect(page.getByText("Sandbox", { exact: true })).toBeVisible();

  // ── 16.5/18.x: the capture endpoint decides, not the page ───────────────
  await page.getByRole("button", { name: "Approve payment" }).click();
  await page.waitForURL(/\/delivery\/[^/]+$/);
  await expect(page.getByText("Payment captured. The original file is unlocked.")).toBeVisible({ timeout: 25_000 });

  // ── 19.x: the signed link serves the real bytes ─────────────────────────
  // The control assigns `window.location.href` to the issued URL, so the tab
  // turns into the file itself: Playwright cannot read the body of that
  // navigation (`Network.getResponseBody` has no resource id for it). Capture
  // the issued URL and ask for it through the request context instead.
  const signedRequest = page.waitForRequest((request) => request.url().includes("/api/files/signed"), {
    timeout: 25_000,
  });

  await page.getByRole("button", { name: "Download original (signed link)" }).click();

  const signedUrl = (await signedRequest).url();
  expect(signedUrl).toContain("sig=");
  expect(signedUrl).toContain("expires=");

  const served = await page.request.get(signedUrl);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("application/pdf");
  expect((await served.body()).subarray(0, 4).toString()).toBe("%PDF");

  // Requirement 19.5 — the signature is what authorises the read, nothing else.
  const tampered = await page.request.get(signedUrl.replace(/sig=[^&]+/, "sig=deadbeef"));
  expect(tampered.status()).toBeGreaterThanOrEqual(400);
});

test("the delivery room shows the captured payment and no retry control", async ({ page }) => {
  await signIn(page, DEMO.client);
  await openRoom(page, SEED.reviewMilestone);

  // Idempotent state from the previous test: the room must still agree that the
  // money arrived and must not offer a second capture.
  await expect(page.getByText("Payment captured. The original file is unlocked.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry capture" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Download original/ })).toBeVisible();
});

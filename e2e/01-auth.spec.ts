import { expect, test } from "@playwright/test";
import { DEMO, DEMO_PASSWORD, register, signIn, uniqueEmail } from "./support";

/**
 * Task 31.1 — registration and login.
 *
 * Requirements 1.1 (registration), 1.2 (duplicate email), 1.3 (session cookie),
 * 1.5 (undifferentiated credential failure) and 1.8 (lockout after five
 * failures).
 *
 * Each test invents its own account so nothing here depends on, or damages, the
 * demo accounts. That matters for the lockout test in particular: a locked
 * account stays locked for fifteen minutes.
 */

test.describe("registration and login", () => {
  test("registers a Client, signs them in and stores a session cookie", async ({ page }) => {
    const email = uniqueEmail("new-client");

    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

    await page.locator("#displayName").fill("E2E New Client");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.locator("#confirm").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // Requirement 1.1 — registration signs the account in and lands on the
    // dashboard rather than asking for the password again.
    await page.waitForURL(/\/briefs$/);
    await expect(page.getByRole("heading", { level: 1, name: "Briefs" })).toBeVisible();

    // Requirement 1.3 — an http-only session cookie, not a localStorage token.
    const session = (await page.context().cookies()).find((cookie) => cookie.name.includes("session-token"));
    expect(session).toBeDefined();
    expect(session!.httpOnly).toBe(true);
    expect(session!.value.length).toBeGreaterThan(0);

    // The dashboard is genuinely reachable with that cookie.
    await page.goto("/briefs");
    await expect(page).toHaveURL(/\/briefs$/);
  });

  test("rejects a duplicate email on the email field", async ({ page }) => {
    await page.goto("/register");
    await page.locator("#displayName").fill("Impostor");
    await page.locator("#email").fill(DEMO.client);
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.locator("#confirm").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // Requirement 1.2 — the error names the field and no session is created.
    await expect(page.getByText("This email is already registered.")).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
    const session = (await page.context().cookies()).find((cookie) => cookie.name.includes("session-token"));
    expect(session).toBeUndefined();
  });

  test("rejects a mismatched password confirmation without calling the API", async ({ page }) => {
    await page.goto("/register");
    await page.locator("#displayName").fill("Mismatch");
    await page.locator("#email").fill(uniqueEmail("mismatch"));
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.locator("#confirm").fill(`${DEMO_PASSWORD}x`);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Passwords do not match.")).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test("demo account selection fills credentials and keeps manual login available", async ({ page }) => {
    await page.goto("/login");
    const demoAccount = page.getByRole("combobox", { name: "Demo account" });
    const email = page.locator("#email");
    const password = page.locator("#password");

    await expect(demoAccount).toHaveValue("");
    await expect(email).toHaveValue("");
    await expect(password).toHaveValue("");
    await expect(demoAccount.getByRole("option")).toHaveText([
      "Choose a demo account",
      "Client — Northwind Studio",
      "Freelancer — Ada Lovelace",
      "Freelancer — Grace Hopper",
    ]);

    for (const account of [DEMO.client, DEMO.freelancer, DEMO.secondFreelancer]) {
      await demoAccount.selectOption(account);
      await expect(email).toHaveValue(account);
      await expect(password).toHaveValue(DEMO_PASSWORD);
      await expect(page).toHaveURL(/\/login$/);
    }

    await email.fill("manual@example.com");
    await expect(demoAccount).toHaveValue("");
    await demoAccount.selectOption(DEMO.client);
    await password.fill("my-own-password");
    await expect(demoAccount).toHaveValue("");

    await demoAccount.selectOption(DEMO.client);
    await demoAccount.selectOption("");
    await expect(email).toHaveValue("");
    await expect(password).toHaveValue("");
  });

  for (const account of [DEMO.client, DEMO.freelancer, DEMO.secondFreelancer]) {
    test(`demo account ${account} signs in and honors the callback`, async ({ page }) => {
      await page.goto("/login?callbackUrl=%2Fagreements");
      await page.getByRole("combobox", { name: "Demo account" }).selectOption(account);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/agreements$/);
      await expect(page.getByRole("heading", { level: 1, name: "Agreements" })).toBeVisible();

      const session = (await page.context().cookies()).find((cookie) => cookie.name.includes("session-token"));
      expect(session).toBeDefined();
    });
  }

  test("demo account selection clears a previous login error", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(uniqueEmail("demo-error"));
    await page.locator("#password").fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Those credentials are not valid.")).toBeVisible();

    await page.getByRole("combobox", { name: "Demo account" }).selectOption(DEMO.client);
    await expect(page.getByText("Those credentials are not valid.")).toHaveCount(0);
    await expect(page.locator("#email")).toHaveValue(DEMO.client);
    await expect(page.locator("#password")).toHaveValue(DEMO_PASSWORD);
  });

  test("demo account dropdown supports keyboard access and responsive themes", async ({ page }, testInfo) => {
    await page.goto("/login");
    const demoAccount = page.getByRole("combobox", { name: "Demo account" });
    await demoAccount.focus();
    await expect(demoAccount).toBeFocused();
    await demoAccount.press("ArrowDown");
    await expect(demoAccount).toHaveValue(DEMO.client);
    await demoAccount.press("Tab");
    await expect(page.locator("#email")).toBeFocused();

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        await expect(demoAccount).toBeVisible();
        await expect(page.getByRole("button", { name: "Sign in" })).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`demo-login-${width}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
  });

  test("signs a seeded Client in with valid credentials", async ({ page }) => {
    await signIn(page, DEMO.client);

    await expect(page.getByRole("heading", { level: 1, name: "Briefs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Agreements" })).toBeVisible();

    const session = (await page.context().cookies()).find((cookie) => cookie.name.includes("session-token"));
    expect(session).toBeDefined();
  });

  test("signs a seeded Freelancer in and shows their invitations", async ({ page }) => {
    await signIn(page, DEMO.freelancer);

    await expect(page.getByRole("heading", { level: 1, name: "Briefs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Collaboration" })).toBeVisible();
  });

  test("never distinguishes an unknown account from a wrong password", async ({ page }) => {
    // Requirement 1.5 — both failures read exactly the same.
    await page.goto("/login");
    await page.locator("#email").fill(uniqueEmail("nobody"));
    await page.locator("#password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Those credentials are not valid.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.locator("#email").fill(DEMO.secondFreelancer);
    await page.locator("#password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Those credentials are not valid.")).toBeVisible();
  });

  test("sends an unauthenticated visitor to login and remembers where they were going", async ({ page }) => {
    await page.goto("/agreements");

    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // The callback is honoured after signing in.
    await page.locator("#email").fill(DEMO.client);
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/agreements$/);
    await expect(page.getByRole("heading", { level: 1, name: "Agreements" })).toBeVisible();
  });

  test("locks the account after five failed attempts and refuses the right password", async ({ page }) => {
    const email = uniqueEmail("lockout");
    const created = await page.request.post("/api/auth/register", {
      data: { email, displayName: "E2E Lockout", password: DEMO_PASSWORD },
    });
    expect(created.status()).toBe(201);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await page.goto("/login");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill("wrong-password-123");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText("Those credentials are not valid.")).toBeVisible();
    }

    // Requirement 1.8 — the sixth attempt is refused even with the right
    // password, and the message says why because waiting is the only remedy.
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("This account is temporarily locked after repeated failed attempts. Try again later."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing out clears the session", async ({ page }) => {
    await signIn(page, DEMO.client);

    await page.getByRole("button", { name: /Sign out/i }).click();
    await page.waitForURL(/\/login/);

    const session = (await page.context().cookies()).find((cookie) => cookie.name.includes("session-token"));
    expect(session).toBeUndefined();

    await page.goto("/briefs");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  });

  test("a freshly registered account starts with empty collections", async ({ page }) => {
    await register(page, { displayName: "E2E Empty", email: uniqueEmail("empty") });

    await expect(page.getByText("No briefs yet")).toBeVisible();
    await expect(page.getByText("No pending invitations")).toBeVisible();

    await page.goto("/agreements");
    await expect(page.getByText("No agreements yet")).toBeVisible();

    await page.goto("/delivery");
    await expect(page.getByText("No milestones yet")).toBeVisible();

    await page.goto("/collaboration");
    await expect(page.getByText("No completed projects yet")).toBeVisible();
  });
});

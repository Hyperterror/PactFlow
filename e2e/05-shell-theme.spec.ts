import { expect, test, type Page } from "@playwright/test";
import { DEMO, register, signIn, uniqueEmail } from "./support";

/**
 * Shell regressions: the dark-mode rail must stay legible and the notification
 * bell must open a popover that is actually on screen.
 *
 * The rail used to borrow `primary-foreground`, which flips dark in dark mode
 * (it is meant to contrast the light primary button), leaving dark-on-dark nav
 * text. These tests pin the contrast and the popover placement so that cannot
 * silently return.
 */

/** WCAG relative luminance from an `rgb(r, g, b)` computed colour. */
function luminance(rgb: string): number {
  const [r, g, b] = rgb
    .replace(/rgba?\(|\)|\s/g, "")
    .split(",")
    .slice(0, 3)
    .map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

async function setDark(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
}

test.describe("shell theme and notifications", () => {
  test("dark-mode nav text keeps readable contrast against the rail", async ({ page }) => {
    await signIn(page, DEMO.client);
    await setDark(page);

    const ratio = await page.evaluate(() => {
      const link = document.querySelector('nav[aria-label="Main"] a')!;
      const rail = document.querySelector("aside")!;
      const fg = getComputedStyle(link).color;
      const bg = getComputedStyle(rail).backgroundColor;
      return { fg, bg };
    });
    // Body text must clear 4.5:1; the old dark-on-dark pairing was ~1.1:1.
    expect(contrast(ratio.fg, ratio.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test("the bell popover opens fully on screen at desktop and mobile widths", async ({ page }) => {
    await signIn(page, DEMO.client);
    await setDark(page);

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: /Notifications/ }).first().click();
      const panel = page.locator("#notifications-panel");
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    }
  });

  test("a brand-new account sees the empty notification state", async ({ page }) => {
    await register(page, { displayName: "E2E Bell Empty", email: uniqueEmail("bell-empty") });
    await setDark(page);

    await page.getByRole("button", { name: /Notifications/ }).first().click();
    const panel = page.locator("#notifications-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("No new updates")).toBeVisible();
  });
});

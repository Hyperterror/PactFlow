"use client";

/**
 * Light is the shipped default; dark is opt-in. The button carries no React
 * state — which icon shows is decided by CSS from `data-theme` — so the server
 * and client render identical markup and there is nothing to hydrate wrong.
 *
 * The stored choice is applied before first paint by the inline script in the
 * root layout, so a dark-mode user never sees an ivory flash.
 */
const STORAGE_KEY = "pactflow-theme";

/** Keeps the mobile browser chrome in step with the canvas colour. */
function syncThemeColor(isDark: boolean) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "#1c2321" : "#f5f3ed");
}

export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    if (next === "dark") {
      root.dataset.theme = "dark";
    } else {
      delete root.dataset.theme;
    }
    syncThemeColor(next === "dark");
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing: the choice simply will not persist.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark appearance"
      title="Switch appearance"
      className={
        className ??
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-inverse-foreground/60 transition-colors hover:bg-inverse-foreground/10 hover:text-inverse-foreground"
      }
    >
      <svg
        className="theme-icon-sun h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
      </svg>
      <svg
        className="theme-icon-moon h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 13.5A8.2 8.2 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z" />
      </svg>
    </button>
  );
}

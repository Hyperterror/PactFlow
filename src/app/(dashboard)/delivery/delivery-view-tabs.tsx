"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The Delivery index has two readings of the same milestones: the Gantt shows
 * when the work lands, the rows show what to open next. Both are one click
 * apart, and the choice lives in the URL so it survives a refresh and can be
 * linked to.
 */

const VIEWS = [
  { id: "timeline", label: "Timeline" },
  { id: "rows", label: "Rows" },
] as const;

export type DeliveryView = (typeof VIEWS)[number]["id"];

export function DeliveryViewTabs({ active }: { active: DeliveryView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(view: DeliveryView) {
    const next = new URLSearchParams(searchParams.toString());
    if (view === "timeline") {
      next.delete("view");
    } else {
      next.set("view", view);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div
      role="tablist"
      aria-label="Delivery view"
      className="inline-flex rounded-lg border border-border-base bg-surface p-0.5"
    >
      {VIEWS.map((view) => {
        const selected = view.id === active;
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => select(view.id)}
            className={`h-8 rounded-[calc(var(--radius-sm)-2px)] px-3 text-xs font-semibold transition-colors ${
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
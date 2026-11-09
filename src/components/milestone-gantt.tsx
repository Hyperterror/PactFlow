"use client";

import { useEffect, useRef, useState } from "react";
import type { ScheduleTask } from "@/lib/milestones/schedule";
import { scheduleDependencies } from "@/lib/milestones/schedule";

/**
 * Requirement 13.6 — the Milestone Gantt view.
 *
 * Bryntum Gantt renders into a plain DOM node rather than through React's tree,
 * so this component owns the lifecycle explicitly: mount the widget once per
 * data set, destroy it on unmount.
 *
 * The package is imported inside the effect, never at module scope. That is what
 * keeps it out of server rendering and out of the first-load bundle: nothing
 * here touches `window` or the Bryntum API until the browser has a container to
 * render into. Reaching for `next/dynamic` with `ssr: false` instead looks
 * tidier but leaves a bailout error in the streamed payload, which strands the
 * page's Suspense boundary on its skeleton.
 *
 * The chart is read-only on purpose. Milestone dates and amounts are contractual
 * terms agreed in the Agreement version — they are changed through the Agreement,
 * not by dragging a bar — so every editing affordance is switched off and the
 * widget is told to reject edits as a second line of defence.
 */

type GanttInstance = {
  destroy: () => void;
  project: {
    taskStore: { data: unknown[] };
    dependencyStore: { data: unknown[] };
  };
  scrollToDate: (date: Date, options?: object) => void;
  print: () => void;
};

/**
 * Files that must be served for the widget to paint, via the vendor route, in
 * cascade order. `svalbard.css` is what Bryntum reads `--b-theme-filename` from:
 * leave it out and the widget decides the page has no theme, hides itself, and
 * fetches one from a CDN. `theme.css` is ours and must come last.
 */
const STYLESHEETS = [
  "/api/vendor/bryntum/fontawesome.css",
  "/api/vendor/bryntum/solid.css",
  "/api/vendor/bryntum/gantt.css",
  "/api/vendor/bryntum/svalbard.css",
  "/api/vendor/bryntum/theme.css",
];

/**
 * Milestone names and descriptions are written by users, and the column renderer
 * returns markup. Escaping keeps a name like `<b>x</b>` literal instead of
 * letting it into the DOM.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadStylesheets(): Promise<void> {
  const loads = STYLESHEETS.map(
    (href) =>
      new Promise<void>((resolve) => {
        if (document.querySelector(`link[data-bryntum="${href}"]`)) {
          resolve();
          return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.bryntum = href;
        // A missing theme must not stop the chart from mounting: the structural
        // CSS alone still lays the rows out.
        link.addEventListener("load", () => resolve());
        link.addEventListener("error", () => resolve());
        document.head.appendChild(link);
      }),
  );
  return Promise.all(loads).then(() => undefined);
}

export function MilestoneGantt({
  tasks,
  agreementTitle,
  currency,
}: {
  tasks: ScheduleTask[];
  agreementTitle: string;
  currency: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ganttRef = useRef<GanttInstance | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;

    async function mount() {
      const container = containerRef.current;
      if (!container) return;

      try {
        await loadStylesheets();
        // Importing the package creates `window.bryntum`; the key is registered
        // before the first widget is constructed so it applies to this instance.
        const { Gantt } = await import("@bryntum/gantt-enterprise");

        if (cancelled) return;

        const licenseKey = process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY ?? "";
        if (licenseKey) {
          (window as unknown as { bryntum?: { licenseKey?: string } }).bryntum ??= {};
          (window as unknown as { bryntum: { licenseKey?: string } }).bryntum.licenseKey = licenseKey;
        }

        const dependencies = scheduleDependencies(tasks).map((link, index) => ({
          id: `link-${index}`,
          from: link.from,
          to: link.to,
          fromSide: "right" as const,
          toSide: "left" as const,
        }));

        const gantt = new Gantt({
          appendTo: container,
          height: "26rem",
          readOnly: true,
          // Every editing surface off: this view reports, it never changes terms.
          features: {
            taskEdit: false,
            taskMenu: false,
            cellEdit: false,
            cellTooltip: false,
            columnResize: false,
            columnReorder: false,
            columnLines: false,
            filter: false,
            dependencyEdit: false,
            taskDrag: false,
            taskResize: false,
            taskNonWorkingTime: true,
            taskTooltip: {
              template: ({ taskRecord }: { taskRecord: { note?: string } }) =>
                `<div class="pf-gantt-tip">${escapeHtml(taskRecord.note ?? "")}</div>`,
            },
          },
          // Zoom is the one interaction worth keeping: it lets a judge see the
          // whole agreement or a single week without leaving the page.
          zoomOnMouseWheel: true,
          zoomKeepsOriginalTimespan: false,
          barMargin: 8,
          rowHeight: 40,
          viewPreset: "weekAndDay",
          columns: [
            {
              field: "name",
              text: "Milestone",
              flex: 1,
              minWidth: 220,
              resizable: false,
              // The renderer returns markup, so Bryntum must leave it alone. The
              // values inside it are escaped above, which is what keeps a
              // milestone name like `<b>x</b>` literal.
              htmlEncode: false,
              // The deadline is the contractual fact, so it stays beside the name.
              renderer: ({ record }: { record: Record<string, unknown> }) => {
                const status = String(record.status ?? "").toLowerCase();
                const paid = record.paymentStatus === "CAPTURED";
                return `<span class="pf-gantt-name">${escapeHtml(String(record.name ?? ""))}</span>` +
                  `<span class="pf-gantt-meta">${escapeHtml(String(record.amountLabel ?? ""))} · ${escapeHtml(status)}${paid ? " · paid" : ""}</span>`;
              },
            },
            {
              field: "endDate",
              text: "Due",
              width: 110,
              resizable: false,
              align: "right",
              htmlEncode: false,
              renderer: ({ value }: { value: Date }) =>
                `<span class="pf-gantt-due">${value.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}</span>`,
            },
          ],
          project: {
            tasks,
            dependencies,
          },
        });

        ganttRef.current = gantt as unknown as GanttInstance;

        // Start on the first milestone rather than today: the story of the
        // agreement is what the chart is for.
        const first = tasks[0];
        if (first) gantt.scrollToDate(new Date(first.startDate), { block: "start" });

        if (!cancelled) setState("ready");
      } catch (error) {
        console.error("Milestone Gantt failed to mount", error);
        if (!cancelled) setState("failed");
      }
    }

    void mount();

    return () => {
      cancelled = true;
      ganttRef.current?.destroy();
      ganttRef.current = null;
    };
    // The chart is rebuilt only when the underlying schedule changes shape; a
    // re-render of the page must not tear down and recreate a 1MB widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tasks)]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {tasks.length} milestone{tasks.length === 1 ? "" : "s"} in {currency}, ordered by due date.
          Dates are agreed terms — open the Agreement to change them.
        </p>
        <button
          type="button"
          onClick={() => ganttRef.current?.print()}
          className="h-8 rounded-lg border border-border-base bg-surface px-3 text-xs font-semibold text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          disabled={state !== "ready"}
        >
          Print timeline
        </button>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="pf-gantt overflow-hidden rounded-[var(--radius)] border border-border-base bg-surface"
          aria-label={`Milestone timeline for ${agreementTitle}`}
          role="img"
        />
        {state === "loading" ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface/70 text-xs text-muted">
            Loading timeline…
          </div>
        ) : null}
        {state === "failed" ? (
          <div className="absolute inset-0 grid place-items-center bg-surface px-6 text-center text-sm text-muted">
            The timeline could not be displayed. The milestone list below carries the same information.
          </div>
        ) : null}
      </div>
    </div>
  );
}
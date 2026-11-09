/**
 * PactFlow's skin for the Bryntum Gantt, layered over the Svalbard base theme.
 *
 * Two things matter here:
 *
 * 1. **The palette.** Bryntum derives every surface from its `--b-neutral-*`
 *    scale, so re-declaring that scale in the ivory/stone range the rest of the
 *    app uses re-skins the whole widget at once — including its popups, which
 *    are rendered into a portal outside the container.
 * 2. **Light is pinned.** The app is light-first with an opt-in dark mode. Bryntum
 *    resolves its colours with `light-dark()`, which follows `color-scheme`; the
 *    chart sets `color-scheme: light` so the palette below always applies and the
 *    widget cannot end up half-dark inside a dark page.
 */
export const PACTFLOW_GANTT_CSS = `
.pf-gantt,
.b-popup:has(.pf-gantt-tip) {
  color-scheme: light;

  /* Warm ivory → stone, replacing Bryntum's pure greys. */
  --b-neutral-100: #fbfaf6;
  --b-neutral-99: #faf8f3;
  --b-neutral-98: #f9f7f1;
  --b-neutral-97: #f7f5ef;
  --b-neutral-96: #f5f3ed;
  --b-neutral-95: #f2efe7;
  --b-neutral-94: #efece4;
  --b-neutral-93: #ece9df;
  --b-neutral-92: #eae7de;
  --b-neutral-91: #e7e3da;
  --b-neutral-90: #e4e1d7;
  --b-neutral-85: #d8d4c8;
  --b-neutral-80: #cecbbf;
  --b-neutral-75: #bfbcaf;
  --b-neutral-70: #b0ac9f;
  --b-neutral-65: #a09c90;
  --b-neutral-60: #8f8b80;
  --b-neutral-55: #7d8883;
  --b-neutral-50: #6c7772;
  --b-neutral-45: #5c6963;
  --b-neutral-40: #4e5a54;
  --b-neutral-35: #414c47;
  --b-neutral-30: #27312e;
  --b-neutral-25: #222b28;
  --b-neutral-20: #1e2623;
  --b-neutral-15: #1a211f;
  --b-neutral-10: #161c1a;
  --b-neutral-5: #121816;
  --b-neutral-2: #0f1413;
  --b-neutral-1: #0d1110;
  --b-neutral-0: #0a0e0d;

  /* Deep forest is the only saturated brand colour. */
  --b-color-blue: #193c35;
  --b-color-orange: #b58a5a;

  font-family: var(--font-geist-sans), system-ui, sans-serif;
  font-size: 13px;
}

.pf-gantt .b-grid-header {
  background: var(--surface-muted);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pf-gantt .b-tree-cell {
  padding-block: 6px;
}

/* Milestone name over its money/status line, so one row carries the whole fact. */
.pf-gantt .pf-gantt-name {
  display: block;
  overflow: hidden;
  color: var(--foreground);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-gantt .pf-gantt-meta {
  display: block;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-gantt .pf-gantt-due {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* Bars: carried by the brand rather than the default blue. */
.pf-gantt .b-gantt-task {
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(39, 49, 46, 0.14);
}

.pf-gantt .b-gantt-task .b-task-text {
  font-size: 11px;
  font-weight: 600;
}

.pf-gantt .b-sch-dependency {
  stroke: var(--border-strong);
  stroke-width: 1.2;
}

.pf-gantt-tip {
  max-width: 22rem;
  color: var(--foreground);
  font-family: var(--font-geist-sans), system-ui, sans-serif;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-line;
}
`;
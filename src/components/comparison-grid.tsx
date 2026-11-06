"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
} from "ag-grid-community";

/**
 * The aligned bid grid, built on AG Grid.
 *
 * The workspace pivots quotations into columns so that a price difference is a
 * row rather than two unrelated tables, which is a shape AG Grid happens to be
 * very good at: the attribute column stays pinned on the left while the bid
 * columns scroll, every column is resizable, and the whole table can be searched
 * or exported without a round trip to the server.
 *
 * The component is loaded with `ssr: false` by its parent, so AG Grid only ever
 * touches the DOM in the browser.
 */

/** One aligned attribute, with a preformatted cell per quotation. */
export interface ComparisonGridRow {
  /** Stable identity so AG Grid can reuse rows between renders. */
  rowKey: string;
  attribute: string;
  /** Totals are emphasised; individual line items are not. */
  emphasis?: boolean;
  cells: Record<string, string>;
}

export interface ComparisonGridColumn {
  quotationId: string;
  freelancerName: string;
}

// The community bundle carries everything these grids need — client-side row
// model, sorting, filtering, quick filter, CSV export and column resizing — so
// registering the aggregate module once is enough.
ModuleRegistry.registerModules([AllCommunityModule]);

/** Matches the slate/indigo palette defined in `globals.css`. */
const pactflowTheme = themeQuartz.withParams({
  accentColor: "#4338ca",
  backgroundColor: "#ffffff",
  borderColor: "#e2e7ee",
  chromeBackgroundColor: "#eef1f5",
  foregroundColor: "#0f172a",
  headerBackgroundColor: "#eef1f5",
  headerTextColor: "#5c6b7f",
  headerFontWeight: 600,
  headerFontSize: 11,
  oddRowBackgroundColor: "#fafbfc",
  rowHoverColor: "#eef0fe",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontSize: 13,
  wrapperBorderRadius: "0.75rem",
  cellHorizontalPadding: 16,
  rowHeight: 40,
  headerHeight: 44,
});

export function ComparisonGrid({
  rows,
  columns,
  briefTitle,
}: {
  rows: ComparisonGridRow[];
  columns: ComparisonGridColumn[];
  briefTitle: string;
}) {
  const apiRef = useRef<GridApi<ComparisonGridRow> | null>(null);
  const [query, setQuery] = useState("");

  const columnDefs = useMemo<ColDef<ComparisonGridRow>[]>(() => {
    // Emphasis is applied per cell rather than through a global class so the
    // grid does not depend on stylesheet load order.
    const emphasisStyle = (params: { data?: ComparisonGridRow }) =>
      params.data?.emphasis ? { fontWeight: 600 } : undefined;

    const attribute: ColDef<ComparisonGridRow> = {
      colId: "attribute",
      headerName: "Attribute",
      pinned: "left",
      minWidth: 170,
      maxWidth: 280,
      cellStyle: emphasisStyle,
    };

    const bids = columns.map<ColDef<ComparisonGridRow>>((column) => ({
      colId: `bid_${column.quotationId}`,
      headerName: column.freelancerName,
      minWidth: 160,
      cellStyle: emphasisStyle,
      valueGetter: (params) => params.data?.cells[column.quotationId] ?? "—",
      // Line items are money or durations; both read better right-aligned.
      cellClass: "text-right tabular-nums",
    }));

    return [attribute, ...bids];
  }, [columns]);

  const onGridReady = useCallback((event: GridReadyEvent<ComparisonGridRow>) => {
    apiRef.current = event.api;
  }, []);

  const onSearch = useCallback((value: string) => {
    setQuery(value);
    apiRef.current?.setGridOption("quickFilterText", value);
  }, []);

  const onExport = useCallback(() => {
    const slug = briefTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    apiRef.current?.exportDataAsCsv({ fileName: `pactflow-comparison-${slug || "brief"}.csv` });
  }, [briefTitle]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="sr-only" htmlFor="comparison-search">
          Search the comparison
        </label>
        <input
          id="comparison-search"
          type="search"
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Filter attributes…"
          className="h-9 w-full max-w-64 rounded-lg border border-border-base bg-surface px-3 text-sm outline-none focus:border-primary sm:w-64"
        />
        <button
          type="button"
          onClick={onExport}
          className="h-9 rounded-lg border border-border-base bg-surface px-3 text-xs font-semibold text-muted hover:text-foreground"
        >
          Export CSV
        </button>
      </div>

      <AgGridReact<ComparisonGridRow>
        rowData={rows}
        columnDefs={columnDefs}
        theme={pactflowTheme}
        domLayout="autoHeight"
        getRowId={(params) => params.data.rowKey}
        onGridReady={onGridReady}
        defaultColDef={{ resizable: true, sortable: false, suppressMovable: true }}
        suppressCellFocus
        animateRows={false}
      />
    </div>
  );
}

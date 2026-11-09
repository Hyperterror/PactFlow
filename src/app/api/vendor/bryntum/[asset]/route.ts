import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PACTFLOW_GANTT_CSS } from "./theme";

/**
 * Serves the Bryntum stylesheets and icon fonts the Milestone Gantt needs.
 *
 * The Gantt is a plain-DOM widget, so its stylesheets are attached at runtime
 * rather than imported through the App Router. That keeps ~500 KB of structural
 * CSS out of the document every page pays for, and it means a missing stylesheet
 * degrades one card instead of failing the whole route.
 *
 * Nothing is read from disk by name from the request: the URL maps through a
 * fixed table, so a request cannot walk out of `node_modules`.
 */

const NODE_MODULES = path.resolve(process.cwd(), "node_modules");

const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

const ASSETS: Record<string, { file: string; type: string }> = {
  "fontawesome.css": {
    file: "@bryntum/core-enterprise/fontawesome/css/fontawesome.css",
    type: "text/css; charset=utf-8",
  },
  "solid.css": {
    file: "@bryntum/core-enterprise/fontawesome/css/solid.css",
    type: "text/css; charset=utf-8",
  },
  "fa-brands-400.woff2": {
    file: "@bryntum/core-enterprise/fontawesome/webfonts/fa-brands-400.woff2",
    type: "font/woff2",
  },
  "fa-regular-400.woff2": {
    file: "@bryntum/core-enterprise/fontawesome/webfonts/fa-regular-400.woff2",
    type: "font/woff2",
  },
  "fa-solid-900.ttf": {
    file: "@bryntum/core-enterprise/fontawesome/webfonts/fa-solid-900.ttf",
    type: "font/ttf",
  },
  "fa-solid-900.woff2": {
    file: "@bryntum/core-enterprise/fontawesome/webfonts/fa-solid-900.woff2",
    type: "font/woff2",
  },
  "fa-v4compatibility.woff2": {
    file: "@bryntum/core-enterprise/fontawesome/webfonts/fa-v4compatibility.woff2",
    type: "font/woff2",
  },
  "gantt.css": {
    file: "@bryntum/gantt-enterprise/gantt.css",
    type: "text/css; charset=utf-8",
  },
  /**
   * The package's own theme, and it has to be served under its real name. Bryntum
   * decides whether an application has a theme by reading `--b-theme-filename`
   * out of the loaded CSS; finding none, it hides the chart and pulls
   * `svalbard-*.css` from jsDelivr. That makes how our page looks depend on a
   * third-party CDN being reachable, and paints a palette over the one below.
   */
  "svalbard.css": {
    file: "@bryntum/gantt-enterprise/svalbard.css",
    type: "text/css; charset=utf-8",
  },
};

/**
 * PactFlow's own skin. It is kept as a module rather than a `.css` file so it
 * ships through the same route as the package stylesheets — one URL for the
 * whole chart, no separate asset pipeline to keep in step. It must load *after*
 * `svalbard.css`, which is the base it overrides.
 */
const INLINE_ASSETS: Record<string, string> = {
  "theme.css": PACTFLOW_GANTT_CSS,
};

/**
 * `solid.css` declares its fonts with `url("../webfonts/…")`, a path that only
 * resolves inside the package. Everything here is served from one flat mount, so
 * the reference is rewritten to that mount on the way out.
 */
const FONT_URL_BASE = "/api/vendor/bryntum/";

const REWRITTEN = new Set(["solid.css"]);

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;

  const inline = INLINE_ASSETS[asset];
  if (inline !== undefined) {
    return new NextResponse(inline, {
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": CACHE_CONTROL },
    });
  }

  const entry = ASSETS[asset];

  if (!entry) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const body = await readFile(path.join(NODE_MODULES, entry.file));
    const payload = REWRITTEN.has(asset)
      ? body.toString("utf8").replace(/\.\.\/webfonts\//g, FONT_URL_BASE)
      : body;
    return new NextResponse(payload, {
      headers: {
        "content-type": entry.type,
        // The asset name is part of the URL and changes only with a dependency
        // upgrade, so it can be cached hard and revalidated in the background.
        "cache-control": CACHE_CONTROL,
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
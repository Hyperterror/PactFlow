"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface SearchHit {
  id: string;
  kind: "Brief" | "Agreement" | "Milestone";
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Command palette. ⌘K / Ctrl+K anywhere in the workspace.
 *
 * The whole point is not having to walk Briefs → Agreement → Delivery to reach
 * a record you already know the name of, so results are typed across all three
 * and keyboard-first: arrows move, Enter opens, Escape closes.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setCursor(0);
  }, []);

  // Global shortcut.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced query.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("search failed");
        const data = (await response.json()) as { results: SearchHit[] };
        setHits(data.results);
        setCursor(0);
      } catch {
        // An aborted or failed search simply leaves the previous results.
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      const hit = hits[cursor];
      if (hit) {
        event.preventDefault();
        router.push(hit.href);
        close();
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border border-inverse-foreground/15 px-2.5 py-1.5 text-xs font-medium text-inverse-foreground/70 transition-colors hover:bg-inverse-foreground/10 hover:text-inverse-foreground lg:flex"
        aria-label="Search briefs, agreements and milestones"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        Search
        <kbd className="rounded border border-inverse-foreground/20 px-1 text-[10px] leading-4">⌘K</kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/35 px-4 pt-[12vh]"
          onClick={close}
          role="presentation"
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-card border border-border-base bg-surface shadow-raised"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
          >
            <label className="sr-only" htmlFor="command-input">
              Search briefs, agreements and milestones
            </label>
            <input
              ref={inputRef}
              id="command-input"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search briefs, agreements, milestones…"
              autoComplete="off"
              spellCheck={false}
              className="w-full border-b border-border-base bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-soft"
            />

            <ul className="max-h-80 overflow-y-auto overscroll-contain" role="listbox" aria-label="Results">
              {query.trim().length < 2 ? (
                <li className="px-4 py-6 text-center text-xs text-muted">
                  Type at least two characters.
                </li>
              ) : loading && hits.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-muted">Searching…</li>
              ) : hits.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-muted">
                  Nothing matches “{query.trim()}”.
                </li>
              ) : (
                hits.map((hit, index) => (
                  <li key={`${hit.kind}-${hit.id}`} role="option" aria-selected={index === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => {
                        router.push(hit.href);
                        close();
                      }}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left",
                        index === cursor ? "bg-primary-soft" : "hover:bg-surface-muted",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{hit.title}</span>
                        <span className="block truncate text-xs text-muted">{hit.subtitle}</span>
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold tracking-wide text-muted-soft uppercase">
                        {hit.kind}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>

            <div className="flex items-center justify-between border-t border-border-base px-4 py-2 text-[11px] text-muted-soft">
              <span>↑↓ to move · Enter to open · Esc to close</span>
              <span>{hits.length > 0 ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : ""}</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

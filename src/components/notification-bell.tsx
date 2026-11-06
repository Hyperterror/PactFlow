"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { humanize } from "@/lib/format";

interface NotificationItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Requirements 7.3 / 3.3 — in-platform delivery is a poll, not a websocket: the
 * bell asks every 30 seconds and the endpoint acknowledges whatever it hands
 * back, so delivery stays inside the 60-second window.
 */
export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await apiRequest<{ pending: NotificationItem[]; recent: NotificationItem[] }>(
          "/api/notifications/poll",
        );
        if (cancelled) return;
        if (data.pending.length > 0) {
          setUnread((count) => count + data.pending.length);
          setItems((current) => [...data.pending, ...current].slice(0, 20));
        }
      } catch {
        // A failed poll is not worth interrupting the user for; the next tick retries.
      }
    }

    void poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // A popover that cannot be dismissed from the keyboard is a trap, and a click
  // beside it should close it rather than leave a panel hanging open.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setUnread(0);
        }}
        className="relative rounded-lg px-2.5 py-2 text-sm text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
        aria-expanded={open}
        aria-controls="notifications-panel"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M15 17h5l-1.4-2.1A2 2 0 0 1 18 13.8V10a6 6 0 1 0-12 0v3.8a2 2 0 0 1-.6 1.1L4 17h11Z" />
          <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
        </svg>
        {unread > 0 ? (
          <span className="tabular absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-danger-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
        {/* Announces arrivals to screen readers without stealing focus. */}
        <span className="sr-only" aria-live="polite">
          {unread > 0 ? `${unread} unread notifications` : ""}
        </span>
      </button>

      {open ? (
        <div
          id="notifications-panel"
          className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-card border border-border-base bg-surface shadow-raised"
        >
          <div className="border-b border-border-base px-4 py-2.5 text-[11px] font-semibold tracking-wide text-muted-soft uppercase">
            Notifications
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing new right now.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-border-base overflow-y-auto overscroll-contain">
              {items.map((item) => (
                <li key={item.id} className="px-4 py-2.5">
                  <p className="text-xs font-semibold text-foreground">{humanize(item.type)}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {typeof item.payload?.briefTitle === "string"
                      ? item.payload.briefTitle
                      : typeof item.payload?.name === "string"
                        ? item.payload.name
                        : "Open the related project for details."}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

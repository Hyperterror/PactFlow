"use client";

import { useEffect, useState } from "react";
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setUnread(0);
        }}
        className="relative rounded-lg px-2.5 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        aria-expanded={open}
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M15 17h5l-1.4-2.1A2 2 0 0 1 18 13.8V10a6 6 0 1 0-12 0v3.8a2 2 0 0 1-.6 1.1L4 17h11Z" />
          <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-card border border-border-base bg-surface shadow-lg">
          <div className="border-b border-border-base px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Notifications
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing new right now.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-border-base overflow-y-auto">
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

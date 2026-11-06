"use client";

import { useCallback } from "react";

/**
 * The two ways a Client Component hands control back to the server once a
 * mutation has landed.
 *
 * `router.refresh()` is the documented way to re-render the current route,
 * `router.replace()` to the same path with a throwaway search param is the usual
 * workaround, and `router.push()` is the documented way to move on — but all
 * three were caught here: the payload is fetched and then the client router
 * keeps rendering the tree it already had, so a write that landed stays
 * invisible, or the transition never commits at all and the screen sits on its
 * busy state until the tab is reloaded. The database always agreed with the
 * user, never with the screen. Mutations are exactly the moments where the
 * server is the source of truth, so both helpers below perform a real document
 * load, which cannot be served from the client router cache.
 *
 * Anything a component needs to keep across a load has to come from the server;
 * local "notice" panels therefore only make sense when no load follows them.
 */
export function useServerRefresh(): () => void {
  return useCallback(() => {
    window.location.reload();
  }, []);
}

/**
 * Continues to `url` after a mutation, as a document load.
 *
 * Same reasoning as above, applied to the routes a mutation leads to: the page
 * the user is sent to is rendered from the write that just happened, and a
 * client-router transition started from an async handler is the least reliable
 * way to ask for it.
 */
export function navigateAfterMutation(url: string): void {
  window.location.assign(url);
}

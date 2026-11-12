/**
 * Resolves the target of an Auth.js `redirect` callback to a same-origin path.
 *
 * Behind Render's proxy the base URL Auth.js detects is the internal bind
 * address (`https://localhost:PORT`), not the public host, because the
 * forwarded host header reaching the app is not the public domain. The default
 * callback prepends that base URL to a relative callback, so signing out sends
 * the browser to `https://localhost:PORT/login` — unreachable from the visitor.
 *
 * Keeping relative paths relative and collapsing absolute targets to their path
 * lets the browser resolve every auth redirect against the origin it is
 * actually on. Protocol-relative (`//host`) and unparseable targets fall back to
 * the sign-in page, matching `safeCallbackUrl`'s same-origin guarantee so this
 * can never become an open redirect.
 */
export function authRedirectUrl(url: string, fallback = "/login"): string {
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const { pathname, search, hash } = new URL(url);
    return `${pathname}${search}${hash}`;
  } catch {
    return fallback;
  }
}
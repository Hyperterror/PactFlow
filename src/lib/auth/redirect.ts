/**
 * Resolves the target of an Auth.js `redirect` callback.
 *
 * Behind Render's proxy the base URL Auth.js detects is the internal bind
 * address (`https://localhost:PORT`), not the public host. The default
 * callback prepends that base URL to a relative callback, so signing out sends
 * the browser to `https://localhost:PORT/login` — unreachable from the visitor.
 *
 * next-auth/react's `signIn({ redirect: false })` passes `data.url` to
 * `new URL(data.url)` to extract the error query param. That constructor throws
 * on relative paths, which the login-form catch block surfaces as "Unable to
 * sign in right now." To avoid this, we return a full absolute URL built from
 * APP_URL so next-auth/react can always parse it. When APP_URL is not set
 * (plain localhost dev) we fall back to the relative path — in that code path
 * next-auth/react is not used with redirect:false in a way that hits this bug.
 *
 * Protocol-relative (`//host`) and unparseable targets fall back to the sign-in
 * page, matching `safeCallbackUrl`'s same-origin guarantee so this can never
 * become an open redirect.
 */
export function authRedirectUrl(url: string, fallback = "/login"): string {
  const appOrigin = (process.env.APP_URL ?? "").replace(/\/$/, "");

  // Resolve the path portion of the target.
  let path: string;
  if (url.startsWith("/") && !url.startsWith("//")) {
    path = url;
  } else {
    try {
      const { pathname, search, hash } = new URL(url);
      path = `${pathname}${search}${hash}`;
    } catch {
      path = fallback;
    }
  }

  // Return a full absolute URL when APP_URL is configured (deployed env).
  // next-auth/react calls `new URL(data.url)` to read error params; a relative
  // path throws there and shows "Unable to sign in right now." in the catch block.
  if (appOrigin.startsWith("http")) {
    return `${appOrigin}${path}`;
  }

  // Local dev: relative paths are fine — next-auth/react resolves them against
  // window.location without calling `new URL()` on a bare path.
  return path;
}

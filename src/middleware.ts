import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware.
 *
 * Requirement 23.4 — plaintext HTTP requests on a public host are redirected to
 * their HTTPS equivalent with HTTP 308. Localhost is exempt so the development
 * server keeps working.
 *
 * Unauthenticated page requests are redirected to the login page with the
 * originally requested URL preserved (Requirement 1.7). The callback target is
 * capped at 2048 characters, matching `safeCallbackUrl`.
 */

// `/` is the public landing page: it renders for anonymous visitors and
// redirects authenticated visitors into their workspace.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/payments/mock-approve",
];
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/webhooks",
  "/api/files/signed",
  // Vendored stylesheets and icon fonts. They carry no user data, and a
  // <link rel="stylesheet"> cannot send a session cookie the way a fetch can.
  "/api/vendor",
  // The cron endpoint authenticates itself with a shared bearer secret.
  "/api/cron",
  "/_next",
  "/favicon.ico",
];
const MAX_CALLBACK_URL_LENGTH = 2048;

function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto.split(",")[0].trim() === "https";
  return request.nextUrl.protocol === "https:";
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".local");
}

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name === "authjs.session-token" || cookie.name === "__Secure-authjs.session-token");
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? request.nextUrl.hostname;
  const hostname = host.split(":")[0];

  if (!isSecureRequest(request) && !isLocalHost(hostname)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(request)) {
    // API routes answer with the JSON envelope instead of a redirect.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "UNAUTHENTICATED", message: "Authentication required." },
        { status: 401 },
      );
    }
    const target = `${pathname}${search}`.slice(0, MAX_CALLBACK_URL_LENGTH);
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?callbackUrl=${encodeURIComponent(target)}`;
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

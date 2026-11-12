import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { authRedirectUrl } from "@/lib/auth/redirect";

/**
 * Regression guard for the deployed sign-out redirect. Behind Render's proxy
 * Auth.js resolves its base URL to the internal bind address, so the default
 * redirect callback sent sign-out to `https://localhost:PORT/login`. The
 * callback must instead keep every target on the origin the browser is on.
 *
 * Also guards against next-auth/react v5 beta throwing `TypeError: Invalid URL`
 * when `signIn({ redirect: false })` calls `new URL(data.url)` on a relative
 * path: when APP_URL is set the function returns an absolute URL so the
 * URL constructor in next-auth/react never sees a bare path.
 */
describe("authRedirectUrl — no APP_URL (local dev)", () => {
  it("keeps same-origin relative paths relative", () => {
    expect(authRedirectUrl("/login")).toBe("/login");
    expect(authRedirectUrl("/briefs")).toBe("/briefs");
    expect(authRedirectUrl("/delivery/abc?tab=files")).toBe("/delivery/abc?tab=files");
  });

  it("collapses an absolute public-origin target to its path", () => {
    expect(authRedirectUrl("https://pactflow-83ou.onrender.com/login")).toBe("/login");
    expect(authRedirectUrl("https://pactflow-83ou.onrender.com/briefs?x=1#top")).toBe("/briefs?x=1#top");
  });

  it("neutralises the internal bind address detected behind the proxy", () => {
    expect(authRedirectUrl("https://localhost:10000/login")).toBe("/login");
    expect(authRedirectUrl("http://localhost:3000/briefs")).toBe("/briefs");
  });

  it("refuses protocol-relative and foreign targets rather than open-redirecting", () => {
    expect(authRedirectUrl("//evil.example/login")).toBe("/login");
    expect(authRedirectUrl("https://evil.example/phish")).toBe("/phish");
  });

  it("falls back to the sign-in page for empty or unparseable input", () => {
    expect(authRedirectUrl("")).toBe("/login");
    expect(authRedirectUrl("not-a-url")).toBe("/login");
    expect(authRedirectUrl("/briefs", "/fallback")).toBe("/briefs");
    expect(authRedirectUrl("garbage", "/fallback")).toBe("/fallback");
  });
});

describe("authRedirectUrl — with APP_URL set (deployed env)", () => {
  const ORIGIN = "https://pactflow-83ou.onrender.com";

  beforeEach(() => {
    process.env.APP_URL = ORIGIN;
  });

  afterEach(() => {
    delete process.env.APP_URL;
  });

  it("returns an absolute URL for relative paths so next-auth/react new URL() does not throw", () => {
    expect(authRedirectUrl("/login")).toBe(`${ORIGIN}/login`);
    expect(authRedirectUrl("/briefs")).toBe(`${ORIGIN}/briefs`);
    expect(authRedirectUrl("/delivery/abc?tab=files")).toBe(`${ORIGIN}/delivery/abc?tab=files`);
  });

  it("strips the internal bind address and returns an absolute URL on the public origin", () => {
    expect(authRedirectUrl("https://localhost:10000/login")).toBe(`${ORIGIN}/login`);
    expect(authRedirectUrl("http://localhost:3000/briefs")).toBe(`${ORIGIN}/briefs`);
  });

  it("strips a foreign absolute URL to path and re-roots on APP_URL origin", () => {
    expect(authRedirectUrl("https://evil.example/phish")).toBe(`${ORIGIN}/phish`);
  });

  it("falls back to absolute sign-in URL for unparseable input", () => {
    expect(authRedirectUrl("")).toBe(`${ORIGIN}/login`);
    expect(authRedirectUrl("not-a-url")).toBe(`${ORIGIN}/login`);
  });

  it("strips trailing slash from APP_URL to avoid double-slash paths", () => {
    process.env.APP_URL = `${ORIGIN}/`;
    expect(authRedirectUrl("/briefs")).toBe(`${ORIGIN}/briefs`);
  });
});

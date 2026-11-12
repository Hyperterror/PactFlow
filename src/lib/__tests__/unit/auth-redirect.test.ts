import { describe, expect, it } from "vitest";
import { authRedirectUrl } from "@/lib/auth/redirect";

/**
 * Regression guard for the deployed sign-out redirect. Behind Render's proxy
 * Auth.js resolves its base URL to the internal bind address, so the default
 * redirect callback sent sign-out to `https://localhost:PORT/login`. The
 * callback must instead keep every target on the origin the browser is on.
 */
describe("authRedirectUrl", () => {
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
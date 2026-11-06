/**
 * Determines whether session cookies must carry the `Secure` flag and the
 * `__Secure-` name prefix. PayPal/Auth.js only accept the secure variant over
 * HTTPS, so plain-HTTP localhost development runs with an insecure cookie.
 */
export function isHttpsDeployment(): boolean {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "";
  if (configured.startsWith("https://")) return true;
  if (configured.startsWith("http://")) return false;
  const production = process.env.NODE_ENV === "production";
  return production && process.env.ALLOW_INSECURE_COOKIES !== "1";
}

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser, safeCallbackUrl } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const user = await getSessionUser();
  const params = await searchParams;
  const raw = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  const callbackUrl = safeCallbackUrl(raw);

  if (user) redirect(callbackUrl);

  return <LoginForm callbackUrl={callbackUrl} />;
}

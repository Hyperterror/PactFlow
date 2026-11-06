import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect("/briefs");

  return <RegisterForm />;
}

"use client";

import { signOut } from "next-auth/react";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void signOut({ callbackUrl: "/login" });
      }}
      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-inverse-foreground/60 transition-colors hover:bg-inverse-foreground/10 hover:text-inverse-foreground"
    >
      {label}
    </button>
  );
}

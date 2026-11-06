"use client";

import { signOut } from "next-auth/react";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void signOut({ callbackUrl: "/login" });
      }}
      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
    >
      {label}
    </button>
  );
}

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    sid?: string;
    user: {
      id: string;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    sid?: string;
    displayName?: string;
  }
}

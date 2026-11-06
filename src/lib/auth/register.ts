import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";

export const RegisterSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .max(254, "Email must be at most 254 characters.")
    .email("Enter a valid email address."),
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(100, "Display name must be at most 100 characters."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(200, "Password must be at most 200 characters."),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Creates a platform account.
 * Requirement 1.2: duplicate email returns a validation error naming the field.
 */
export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ValidationError([
      { field: "email", message: "This email is already registered." },
    ]);
  }

  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, displayName: input.displayName, passwordHash },
    });
    await writeAuditLog(tx, {
      eventType: "USER_REGISTERED",
      actorId: user.id,
      resourceId: user.id,
      resourceType: "User",
      previousState: null,
      newState: "REGISTERED",
      metadata: { email: user.email },
    });
    return { id: user.id, email: user.email, displayName: user.displayName };
  });
}

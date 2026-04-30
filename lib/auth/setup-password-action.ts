"use server";

import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { consumeSetupToken, verifySetupToken } from "@/lib/auth/password-reset";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export async function setupPasswordAction(formData: FormData): Promise<void> {
  const rawToken = formData.get("token") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (password.length < 8) {
    redirect(`/setup-password?token=${encodeURIComponent(rawToken)}&error=short`);
  }
  if (password !== confirmPassword) {
    redirect(`/setup-password?token=${encodeURIComponent(rawToken)}&error=mismatch`);
  }

  const data = await verifySetupToken(rawToken);
  if (!data) {
    redirect("/login?error=TokenExpired");
  }

  try {
    const passwordHash = await hashPassword(password);
    const now = new Date();

    const existing = await db.query.users.findFirst({
      where: eq(users.email, data.email),
      columns: { id: true },
    });

    if (existing) {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, existing.id));
    } else {
      await db.insert(users).values({
        email: data.email,
        passwordHash,
        emailVerified: now,
      });
    }

    await consumeSetupToken(rawToken);
  } catch (err) {
    console.error("[setup-password] erro ao salvar senha:", err);
    redirect(`/setup-password?token=${encodeURIComponent(rawToken)}&error=ServerError`);
  }

  redirect("/login?success=PasswordSet");
}

/**
 * Bootstrap the owner user with a password.
 * Usage: npx tsx scripts/bootstrap-owner.ts <password>
 */
import "dotenv/config";
import { db } from "../lib/db/client";
import { users } from "../db/schema";
import { hashPassword } from "../lib/auth/password";
import { eq } from "drizzle-orm";

const email = process.env.OWNER_EMAIL;
const password = process.argv[2];

if (!email) {
  console.error("OWNER_EMAIL not set in .env.local");
  process.exit(1);
}

if (!password || password.length < 8) {
  console.error("Usage: npx tsx scripts/bootstrap-owner.ts <password> (min 8 chars)");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const now = new Date();

const existing = await db.query.users.findFirst({
  where: eq(users.email, email),
  columns: { id: true },
});

if (existing) {
  await db.update(users).set({ passwordHash, isOwner: true, isActive: true, updatedAt: now }).where(eq(users.id, existing.id));
  console.log(`✓ Senha atualizada para ${email}`);
} else {
  await db.insert(users).values({ email, passwordHash, isOwner: true, isActive: true, emailVerified: now });
  console.log(`✓ Usuário owner criado: ${email}`);
}

process.exit(0);

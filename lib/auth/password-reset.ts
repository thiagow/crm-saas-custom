import { verificationTokens } from "@/db/schema";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { Resend } from "resend";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function createSetupToken(email: string): Promise<string> {
  // Remove any existing token for this email before creating a new one
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, email));

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + TTL_MS);

  await db.insert(verificationTokens).values({ identifier: email, token, expires });

  return token;
}

export async function verifySetupToken(token: string): Promise<{ email: string } | null> {
  const record = await db.query.verificationTokens.findFirst({
    where: eq(verificationTokens.token, token),
  });

  if (!record) return null;

  if (record.expires < new Date()) {
    await db.delete(verificationTokens).where(eq(verificationTokens.token, token));
    return null;
  }

  return { email: record.identifier };
}

export async function consumeSetupToken(token: string): Promise<void> {
  await db.delete(verificationTokens).where(eq(verificationTokens.token, token));
}

export async function sendPasswordSetupEmail(email: string, token: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const appUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const setupUrl = `${appUrl}/setup-password?token=${encodeURIComponent(token)}`;

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: email,
    subject: "Defina sua senha — CRM",
    html: `
<!DOCTYPE html>
<html>
<body style="background:#0a0a0a;color:#e4e4e7;font-family:system-ui,sans-serif;padding:40px 20px;margin:0">
  <div style="max-width:480px;margin:0 auto">
    <div style="width:40px;height:40px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
      <span style="color:#818cf8;font-size:20px">⬡</span>
    </div>
    <h1 style="font-size:20px;font-weight:600;color:#f4f4f5;margin:0 0 8px">Defina sua senha</h1>
    <p style="color:#71717a;font-size:14px;margin:0 0 32px;line-height:1.6">
      Clique no botão abaixo para definir sua senha de acesso ao CRM. O link expira em 24 horas.
    </p>
    <a href="${setupUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500">
      Definir senha
    </a>
    <p style="color:#52525b;font-size:12px;margin-top:32px">
      Se você não solicitou isso, pode ignorar este email com segurança.
    </p>
  </div>
</body>
</html>`,
  });

  if (error) throw new Error(`Falha ao enviar email: ${error.message}`);
}

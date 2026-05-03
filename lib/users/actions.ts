"use server";

import { invites, projectMembers, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createSetupToken } from "@/lib/auth/password-reset";
import { db } from "@/lib/db/client";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { z } from "zod";

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Guard ───────────────────────────────────────────────────────────────────

async function requireOwner() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { isOwner: true, isActive: true },
  });
  if (!user?.isOwner) throw new Error("Forbidden: owner only");

  return session.user.id;
}

// ─── Invite user ─────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email(),
  projectId: z.string().uuid().optional(),
  role: z.enum(["owner", "admin", "sales", "viewer"]).default("sales"),
});

export async function inviteUser(input: z.infer<typeof inviteSchema>) {
  const invitedById = await requireOwner();
  const data = inviteSchema.parse(input);

  // If user already exists and is active, just add to project if requested
  const existing = await db.query.users.findFirst({
    where: eq(users.email, data.email),
    columns: { id: true, isActive: true },
  });

  if (existing) {
    if (!existing.isActive) {
      throw new Error("Usuário existe mas está desativado. Reative-o primeiro.");
    }
    if (data.projectId) {
      const alreadyMember = await db.query.projectMembers.findFirst({
        where: and(
          eq(projectMembers.userId, existing.id),
          eq(projectMembers.projectId, data.projectId),
        ),
      });
      if (!alreadyMember) {
        await db.insert(projectMembers).values({
          userId: existing.id,
          projectId: data.projectId,
          role: data.role,
        });
        revalidatePath("/settings/users");
      }
    }
    return { status: "already_user" as const };
  }

  // Delete any expired or old pending invite for this email so we can re-invite cleanly
  await db.delete(invites).where(and(eq(invites.email, data.email), isNull(invites.acceptedAt)));

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [newInvite] = await db
    .insert(invites)
    .values({
      email: data.email,
      projectId: data.projectId ?? null,
      role: data.role,
      invitedById,
      token,
      expiresAt,
    })
    .returning();

  const setupToken = await createSetupToken(data.email);
  const appUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const setupUrl = `${appUrl}/setup-password?token=${encodeURIComponent(setupToken)}`;

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: data.email,
    subject: "Você foi convidado para o CRM",
    html: `
<!DOCTYPE html>
<html>
<body style="background:#0a0a0a;color:#e4e4e7;font-family:system-ui,sans-serif;padding:40px 20px;margin:0">
  <div style="max-width:480px;margin:0 auto">
    <div style="width:40px;height:40px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
      <span style="color:#818cf8;font-size:20px">⬡</span>
    </div>
    <h1 style="font-size:20px;font-weight:600;color:#f4f4f5;margin:0 0 8px">Você foi convidado</h1>
    <p style="color:#71717a;font-size:14px;margin:0 0 32px;line-height:1.6">
      Você recebeu um convite para acessar o CRM. Clique no botão abaixo para definir sua senha e entrar.
    </p>
    <a href="${setupUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500">
      Definir senha e acessar
    </a>
    <p style="color:#52525b;font-size:12px;margin-top:32px">
      Este link expira em 24 horas. Se você não esperava este email, pode ignorá-lo.
    </p>
  </div>
</body>
</html>`,
  });

  if (error) throw new Error(`Falha ao enviar email: ${error.message}`);

  revalidatePath("/settings/users");
  return {
    status: "invited" as const,
    invite: {
      id: newInvite!.id,
      email: newInvite!.email,
      role: newInvite!.role,
      expiresAt: newInvite!.expiresAt,
      project: data.projectId ? { name: "", slug: "" } : null,
      invitedBy: null,
    },
  };
}

// ─── Toggle user active state ─────────────────────────────────────────────────

const setActiveSchema = z.object({
  userId: z.string().min(1),
  isActive: z.boolean(),
});

export async function setUserActive(input: z.infer<typeof setActiveSchema>) {
  const callerId = await requireOwner();
  const { userId, isActive } = setActiveSchema.parse(input);

  if (userId === callerId) throw new Error("Você não pode se desativar.");

  await db
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(users.id, userId));

  revalidatePath("/settings/users");
}

// ─── Revoke invite ────────────────────────────────────────────────────────────

const revokeInviteSchema = z.object({ inviteId: z.string().min(1) });

export async function revokeInvite(input: z.infer<typeof revokeInviteSchema>) {
  await requireOwner();
  const { inviteId } = revokeInviteSchema.parse(input);

  await db.delete(invites).where(eq(invites.id, inviteId));

  revalidatePath("/settings/users");
}

const setProjectAccessSchema = z.object({
  targetUserId: z.string().min(1),
  projectId: z.string().uuid(),
  role: z.enum(["owner", "admin", "sales", "viewer"]).nullable(),
});

export async function setUserProjectAccess(input: z.infer<typeof setProjectAccessSchema>) {
  const callerId = await requireOwner();
  const { targetUserId, projectId, role } = setProjectAccessSchema.parse(input);

  if (targetUserId === callerId) throw new Error("Não é possível alterar seu próprio acesso.");

  const existing = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.userId, targetUserId),
      eq(projectMembers.projectId, projectId),
    ),
    columns: { id: true },
  });

  if (role === null) {
    if (existing) {
      await db.delete(projectMembers).where(eq(projectMembers.id, existing.id));
    }
  } else if (existing) {
    await db.update(projectMembers).set({ role }).where(eq(projectMembers.id, existing.id));
  } else {
    await db.insert(projectMembers).values({ userId: targetUserId, projectId, role });
  }

  revalidatePath("/settings/users");
  revalidatePath(`/settings/users/${targetUserId}`);
}

// ─── Check access (used by login page and auth config) ───────────────────────
// Returns true if email is allowed to sign in.

export async function checkEmailAccess(email: string): Promise<boolean> {
  // Owner bypass — allows first login for bootstrapping
  if (process.env.OWNER_EMAIL && email === process.env.OWNER_EMAIL) {
    return true;
  }

  const now = new Date();

  // Active user already in the system
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { isActive: true },
  });
  if (user) return user.isActive;

  // Valid pending invite
  const invite = await db.query.invites.findFirst({
    where: and(
      eq(invites.email, email),
      isNull(invites.acceptedAt),
      gt(invites.expiresAt, now),
    ),
    columns: { id: true },
  });
  return !!invite;
}

import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { consumeSetupToken, verifySetupToken } from "@/lib/auth/password-reset";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export default async function SetupPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";
  const error = params.error;

  // Validate token server-side before rendering the form
  const tokenData = await verifySetupToken(token);
  if (!tokenData) {
    redirect("/login?error=TokenExpired");
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
            <svg
              className="w-5 h-5 text-indigo-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Defina sua senha</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Crie uma senha para acessar o CRM
          </p>
        </div>

        {error === "mismatch" && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-sm text-red-400">As senhas não coincidem.</p>
          </div>
        )}
        {error === "short" && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-sm text-red-400">A senha deve ter no mínimo 8 caracteres.</p>
          </div>
        )}

        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            "use server";
            const rawToken = formData.get("token") as string;
            const password = formData.get("password") as string;
            const confirmPassword = formData.get("confirmPassword") as string;

            if (password.length < 8) {
              redirect(`/setup-password?token=${encodeURIComponent(rawToken)}&error=short`);
            }
            if (password !== confirmPassword) {
              redirect(`/setup-password?token=${encodeURIComponent(rawToken)}&error=mismatch`);
            }

            // Re-verify token inside the action (prevents replay after expiry)
            const data = await verifySetupToken(rawToken);
            if (!data) {
              redirect("/login?error=TokenExpired");
            }

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
            redirect("/login?success=PasswordSet");
          }}
        >
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-400 mb-1.5">
              Nova senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              autoFocus
              minLength={8}
              placeholder="Mínimo 8 caracteres"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-zinc-400 mb-1.5"
            >
              Confirmar senha
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              placeholder="Repita a senha"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] transition-colors"
          >
            Salvar senha
          </button>
        </form>
      </div>
    </div>
  );
}

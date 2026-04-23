import { checkEmailAccess } from "@/lib/users/actions";
import { createSetupToken, sendPasswordSetupEmail } from "@/lib/auth/password-reset";
import { redirect } from "next/navigation";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const params = await searchParams;
  const sent = params.sent === "true";

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
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Redefinir senha</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {sent
              ? "Verifique seu email"
              : "Informe seu email para receber o link"}
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <p className="text-sm text-emerald-400">
                Se esse email estiver cadastrado, você receberá um link em instantes.
              </p>
            </div>
            <p className="text-center text-xs text-zinc-600">
              Não recebeu? Verifique sua caixa de spam ou{" "}
              <a
                href="/forgot-password"
                className="text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                tente novamente
              </a>
              .
            </p>
          </div>
        ) : (
          <form
            className="space-y-3"
            action={async (formData: FormData) => {
              "use server";
              const email = formData.get("email") as string;

              // Always redirect with sent=true regardless of whether email is allowed
              // to prevent email enumeration
              const allowed = await checkEmailAccess(email);
              if (allowed) {
                try {
                  const token = await createSetupToken(email);
                  await sendPasswordSetupEmail(email, token);
                } catch {
                  // Silently fail — don't reveal errors to prevent enumeration
                }
              }

              redirect("/forgot-password?sent=true");
            }}
          >
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                placeholder="seu@email.com"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] transition-colors"
            >
              Enviar link de redefinição
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <a
            href="/login"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Voltar ao login
          </a>
        </div>
      </div>
    </div>
  );
}

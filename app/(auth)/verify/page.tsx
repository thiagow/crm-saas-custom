export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 mb-6">
          <svg
            className="w-6 h-6 text-indigo-400"
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
        <h1 className="text-xl font-semibold text-white mb-2">Verifique seu email</h1>
        <p className="text-sm text-zinc-500">
          Enviamos um link de acesso para o seu email. Clique no link para entrar.
        </p>
        <p className="mt-4 text-xs text-zinc-600">
          Não recebeu? Verifique sua caixa de spam ou{" "}
          <a href="/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">
            tente novamente
          </a>
          .
        </p>
      </div>
    </div>
  );
}

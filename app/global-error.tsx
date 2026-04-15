"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="bg-zinc-950 text-zinc-100 flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold">Algo deu errado</h1>
          <p className="text-zinc-500 text-sm">
            Ocorreu um erro inesperado. Nossa equipe foi notificada.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}

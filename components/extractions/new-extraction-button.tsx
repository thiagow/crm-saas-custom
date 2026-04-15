"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createExtraction } from "@/lib/extractions/actions";
import { estimateCost } from "@/lib/extractions/utils";

interface NewExtractionButtonProps {
  projectSlug: string;
}

export function NewExtractionButton({ projectSlug }: NewExtractionButtonProps) {
  const [open, setOpen] = useState(false);
  const [maxResults, setMaxResults] = useState(100);
  const [, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      try {
        await createExtraction({
          projectSlug,
          query: data.get("query") as string,
          city: data.get("city") as string,
          state: data.get("state") as string,
          maxResults: Number(data.get("maxResults")),
        });
        setOpen(false);
        toast.success("Extração iniciada! Aguarde os resultados.");
        form.reset();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao iniciar extração");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
        Nova extração
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-zinc-100">Nova extração</h2>
              <p className="text-sm text-zinc-500 mt-0.5">Busca empresas via Google Maps.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Segmento / tipo de negócio
                </label>
                <input
                  name="query"
                  required
                  autoFocus
                  placeholder="Ex: academia de muay thai"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Cidade</label>
                  <input
                    name="city"
                    required
                    placeholder="Ex: São Paulo"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Estado</label>
                  <input
                    name="state"
                    required
                    placeholder="Ex: SP"
                    maxLength={2}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Máximo de resultados
                  <span className="ml-2 text-xs text-zinc-600">
                    Custo estimado: ~${estimateCost(maxResults).toFixed(2)} USD
                  </span>
                </label>
                <input
                  name="maxResults"
                  type="number"
                  min={10}
                  max={200}
                  value={maxResults}
                  onChange={(e) => setMaxResults(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg border border-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
                >
                  Iniciar extração
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}

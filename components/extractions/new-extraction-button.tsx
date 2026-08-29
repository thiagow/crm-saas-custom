"use client";

import { checkExtractionOverlap, createExtraction } from "@/lib/extractions/actions";
import { estimateCost } from "@/lib/extractions/utils";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

interface NewExtractionButtonProps {
  projectSlug: string;
}

/** Mirrors ExtractionFilters (db/schema/extractions.ts) — the search-space partition axes. */
interface SearchFilters {
  websiteFilter?: "allPlaces" | "withWebsite" | "withoutWebsite" | undefined;
  minStars?:
    | ""
    | "two"
    | "twoAndHalf"
    | "three"
    | "threeAndHalf"
    | "four"
    | "fourAndHalf"
    | undefined;
  searchMatching?: "all" | "only_includes" | "only_exact" | undefined;
  postalCode?: string | undefined;
}

type OverlapReport = Awaited<ReturnType<typeof checkExtractionOverlap>>;

const WEBSITE_OPTIONS = [
  { value: "allPlaces", label: "Todas" },
  { value: "withoutWebsite", label: "Só sem site" },
  { value: "withWebsite", label: "Só com site" },
] as const;

const STARS_OPTIONS = [
  { value: "", label: "Qualquer nota" },
  { value: "three", label: "3+ estrelas" },
  { value: "four", label: "4+ estrelas" },
  { value: "fourAndHalf", label: "4,5+ estrelas" },
] as const;

export function NewExtractionButton({ projectSlug }: NewExtractionButtonProps) {
  const [open, setOpen] = useState(false);
  const [maxResults, setMaxResults] = useState(100);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [overlap, setOverlap] = useState<OverlapReport | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, startTransition] = useTransition();

  const canCheck = query.trim().length >= 2 && city.trim().length >= 2 && state.trim().length >= 2;

  // Re-check whenever the search identity changes. Applying a partition filter is exactly
  // how the user escapes the block, so the warning has to react to it immediately.
  const runCheck = useCallback(async () => {
    if (!canCheck) {
      setOverlap(null);
      return;
    }
    setChecking(true);
    try {
      const report = await checkExtractionOverlap({
        projectSlug,
        query,
        city,
        state,
        filters,
      });
      setOverlap(report);
      // A different slice is a different search — a stale acknowledgement must not carry over.
      if (!report.alreadyRan) setAcknowledged(false);
    } catch {
      // A failed pre-flight check must never block the user; the server enforces the
      // same rule on submit anyway.
      setOverlap(null);
    } finally {
      setChecking(false);
    }
  }, [canCheck, projectSlug, query, city, state, filters]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(runCheck, 400);
    return () => clearTimeout(timer);
  }, [open, runCheck]);

  function resetForm() {
    setQuery("");
    setCity("");
    setState("");
    setFilters({});
    setOverlap(null);
    setAcknowledged(false);
  }

  const isBlocked = !!overlap?.alreadyRan && !acknowledged;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isBlocked) return;

    startTransition(async () => {
      try {
        await createExtraction({
          projectSlug,
          query,
          city,
          state,
          maxResults,
          enrichContacts: true,
          filters,
          acknowledgeDuplicate: acknowledged,
        });
        setOpen(false);
        resetForm();
        toast.success("Extração iniciada! Aguarde os resultados.");
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
          <title>Adicionar</title>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
        Nova extração
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Fechar"
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-zinc-100">Nova extração</h2>
              <p className="text-sm text-zinc-500 mt-0.5">Busca empresas via Google Maps.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="extraction-query"
                  className="block text-sm font-medium text-zinc-400 mb-1.5"
                >
                  Segmento / tipo de negócio
                </label>
                <input
                  id="extraction-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  required
                  // biome-ignore lint/a11y/noAutofocus: first field of a modal the user just opened.
                  autoFocus
                  placeholder="Ex: academia de muay thai"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="extraction-city"
                    className="block text-sm font-medium text-zinc-400 mb-1.5"
                  >
                    Cidade
                  </label>
                  <input
                    id="extraction-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                    placeholder="Ex: São Paulo"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label
                    htmlFor="extraction-state"
                    className="block text-sm font-medium text-zinc-400 mb-1.5"
                  >
                    Estado
                  </label>
                  <input
                    id="extraction-state"
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    required
                    placeholder="Ex: SP"
                    maxLength={2}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Partition axes. Apify has no pagination, so these are the only way to
                  reach businesses a previous run did not return. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="extraction-website"
                    className="block text-sm font-medium text-zinc-400 mb-1.5"
                  >
                    Site
                  </label>
                  <select
                    id="extraction-website"
                    value={filters.websiteFilter ?? "allPlaces"}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        websiteFilter: e.target.value as SearchFilters["websiteFilter"],
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {WEBSITE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="extraction-stars"
                    className="block text-sm font-medium text-zinc-400 mb-1.5"
                  >
                    Avaliação mínima
                  </label>
                  <select
                    id="extraction-stars"
                    value={filters.minStars ?? ""}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        minStars: e.target.value as SearchFilters["minStars"],
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {STARS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="extraction-max"
                  className="block text-sm font-medium text-zinc-400 mb-1.5"
                >
                  Máximo de resultados
                  <span className="ml-2 text-xs text-zinc-600">
                    Custo estimado: ~${estimateCost(maxResults).toFixed(2)} USD
                  </span>
                </label>
                <input
                  id="extraction-max"
                  type="number"
                  min={10}
                  max={200}
                  value={maxResults}
                  onChange={(e) => setMaxResults(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>

              {checking && <p className="text-xs text-zinc-600">Verificando buscas anteriores…</p>}

              {overlap?.alreadyRan && (
                <div className="rounded-lg border border-amber-700/50 bg-amber-500/5 p-3 space-y-3">
                  <p className="text-xs text-amber-300 leading-relaxed">
                    Você já fez esta busca
                    {overlap.lastRunAt
                      ? ` ${formatDistanceToNow(new Date(overlap.lastRunAt), {
                          addSuffix: true,
                          locale: ptBR,
                        })}`
                      : ""}{" "}
                    — <strong>{overlap.placesInBase} empresas</strong> desta cidade já estão na
                    base. Repetir vai trazer as mesmas e gastar crédito à toa.
                  </p>

                  {overlap.suggestions.length > 0 && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                        Para alcançar empresas novas
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {overlap.suggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            title={s.hint}
                            onClick={() => setFilters((f) => ({ ...f, ...s.filters }))}
                            className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-indigo-600 hover:text-white transition-colors"
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="flex items-start gap-2 text-xs text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                      className="mt-0.5 accent-amber-500"
                    />
                    <span>Sei que vai repetir e quero rodar mesmo assim.</span>
                  </label>
                </div>
              )}

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
                  disabled={isBlocked || submitting}
                  className={cn(
                    "flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors",
                    isBlocked || submitting
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-500",
                  )}
                >
                  {submitting ? "Iniciando…" : isBlocked ? "Busca repetida" : "Iniciar extração"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}

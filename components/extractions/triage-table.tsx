"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  discardResults,
  getTriageResults,
  promoteResultsToLeads,
} from "@/lib/extractions/actions";
import { cn } from "@/lib/utils";

type TriageResult = Awaited<ReturnType<typeof getTriageResults>>[number];

interface Stage {
  id: string;
  name: string;
  color: string;
}

interface TriageTableProps {
  projectSlug: string;
  stages: Stage[];
  defaultStageId: string;
  initialExtractionId: string | undefined;
}

export function TriageTable({
  projectSlug,
  stages,
  defaultStageId,
  initialExtractionId,
}: TriageTableProps) {
  const [results, setResults] = useState<TriageResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetStageId, setTargetStageId] = useState(defaultStageId);
  const [, startTransition] = useTransition();

  // Filters
  const [hasPhone, setHasPhone] = useState(false);
  const [hasSite, setHasSite] = useState(false);
  const [hasInstagram, setHasInstagram] = useState(false);
  const [minRating, setMinRating] = useState<number | undefined>();
  const [orderBy, setOrderBy] = useState<"rating" | "reviews" | "name">("rating");

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTriageResults({
        projectSlug,
        extractionId: initialExtractionId,
        hasPhone: hasPhone || undefined,
        hasSite: hasSite || undefined,
        hasInstagram: hasInstagram || undefined,
        minRating,
        orderBy,
        page: 1,
        pageSize: 100,
      });
      setResults(data);
      setSelected(new Set());
    } catch {
      toast.error("Erro ao carregar resultados");
    } finally {
      setLoading(false);
    }
  }, [projectSlug, initialExtractionId, hasPhone, hasSite, hasInstagram, minRating, orderBy]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  function toggleAll() {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((r) => r.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handlePromote() {
    if (selected.size === 0) return;
    startTransition(async () => {
      try {
        const { promoted } = await promoteResultsToLeads({
          projectSlug,
          resultIds: Array.from(selected),
          stageId: targetStageId,
        });
        toast.success(`${promoted} leads criados no Kanban`);
        await loadResults();
      } catch {
        toast.error("Erro ao promover leads");
      }
    });
  }

  function handleDiscard() {
    if (selected.size === 0) return;
    startTransition(async () => {
      try {
        await discardResults({ resultIds: Array.from(selected), projectSlug });
        toast.success(`${selected.size} resultados descartados`);
        await loadResults();
      } catch {
        toast.error("Erro ao descartar");
      }
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header + filters */}
      <div className="border-b border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Triagem</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {results.length} resultados pendentes · {selected.size} selecionados
            </p>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={targetStageId}
                onChange={(e) => setTargetStageId(e.target.value)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handlePromote}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
              >
                Promover {selected.size} a leads →
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:border-red-800 hover:text-red-400 transition-colors"
              >
                Descartar
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: "Tem telefone", value: hasPhone, set: setHasPhone },
            { label: "Tem site", value: hasSite, set: setHasSite },
            { label: "Tem Instagram", value: hasInstagram, set: setHasInstagram },
          ].map(({ label, value, set }) => (
            <button
              key={label}
              type="button"
              onClick={() => set(!value)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                value ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700",
              )}
            >
              {label}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-600">Rating mín:</span>
            <input
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={minRating ?? ""}
              onChange={(e) =>
                setMinRating(e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="—"
              className="w-14 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-zinc-600">Ordenar:</span>
            <select
              value={orderBy}
              onChange={(e) => setOrderBy(e.target.value as typeof orderBy)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="rating">Rating</option>
              <option value="reviews">Avaliações</option>
              <option value="name">Nome</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-zinc-500">Nenhum resultado pendente.</p>
            <p className="text-xs text-zinc-700 mt-1">
              Ajuste os filtros ou rode uma nova extração.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-800 text-left">
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === results.length && results.length > 0}
                    onChange={toggleAll}
                    className="accent-indigo-500"
                  />
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Empresa
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Localização
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Contato
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Rating
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Instagram
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {results.map((result) => (
                <tr
                  key={result.id}
                  onClick={() => toggleOne(result.id)}
                  className={cn(
                    "cursor-pointer transition-colors",
                    selected.has(result.id)
                      ? "bg-indigo-500/5"
                      : "hover:bg-zinc-900/50",
                  )}
                >
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(result.id)}
                      onChange={() => toggleOne(result.id)}
                      className="accent-indigo-500"
                    />
                  </td>
                  <td className="p-3">
                    <p className="font-medium text-zinc-200 leading-snug">{result.name}</p>
                    {result.category && (
                      <p className="text-xs text-zinc-600 mt-0.5">{result.category}</p>
                    )}
                  </td>
                  <td className="p-3 text-zinc-400 text-xs">
                    {result.city}, {result.state}
                  </td>
                  <td className="p-3">
                    {result.phone && (
                      <p className="text-xs text-zinc-400">{result.phone}</p>
                    )}
                    {result.website && (
                      <a
                        href={result.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-indigo-400 hover:text-indigo-300 truncate block max-w-32"
                      >
                        {result.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </td>
                  <td className="p-3">
                    {result.rating ? (
                      <div>
                        <span className="text-xs font-medium text-zinc-300">
                          {result.rating.toFixed(1)} ★
                        </span>
                        {result.reviewsCount && (
                          <span className="text-xs text-zinc-600 ml-1">
                            ({result.reviewsCount})
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {result.instagramHandle ? (
                      <a
                        href={`https://instagram.com/${result.instagramHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-zinc-400 hover:text-indigo-400 transition-colors"
                      >
                        @{result.instagramHandle}
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-700">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

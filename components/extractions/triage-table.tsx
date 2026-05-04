"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  discardResults,
  getTriageResults,
  promoteResultsToLeads,
  updateExtractionResult,
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

  // Edit modal
  const [editingResult, setEditingResult] = useState<TriageResult | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    website: "",
    instagramHandle: "",
    city: "",
    state: "",
  });
  const [editPending, startEditTransition] = useTransition();

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

  function openEditModal(result: TriageResult, e: React.MouseEvent) {
    e.stopPropagation();
    setEditForm({
      name: result.name ?? "",
      phone: result.phone ?? "",
      website: result.website ?? "",
      instagramHandle: result.instagramHandle ?? "",
      city: result.city ?? "",
      state: result.state ?? "",
    });
    setEditingResult(result);
  }

  function closeEditModal() {
    setEditingResult(null);
  }

  function handleSaveEdit() {
    if (!editingResult) return;
    startEditTransition(async () => {
      try {
        const website =
          editForm.website && !/^https?:\/\//i.test(editForm.website)
            ? `https://${editForm.website}`
            : editForm.website;
        await updateExtractionResult({
          resultId: editingResult.id,
          projectSlug,
          ...editForm,
          website,
        });
        setResults((prev) =>
          prev.map((r) =>
            r.id === editingResult.id
              ? {
                  ...r,
                  name: editForm.name,
                  phone: editForm.phone || null,
                  website: editForm.website || null,
                  instagramHandle: editForm.instagramHandle || null,
                  city: editForm.city || null,
                  state: editForm.state || null,
                }
              : r,
          ),
        );
        toast.success("Informações atualizadas");
        closeEditModal();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
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
                <th className="p-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {results.map((result) => (
                <tr
                  key={result.id}
                  onClick={() => toggleOne(result.id)}
                  className={cn(
                    "cursor-pointer transition-colors group",
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
                  <td className="p-3 w-10" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => openEditModal(result, e)}
                      className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
                      title="Editar informações"
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 17.25V21h3.75L17.81 9.94m-6.75-6.75l2.5-2.5a2.121 2.121 0 013 3l-2.5 2.5m0 0L9.86 9.86" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingResult && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={closeEditModal}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-zinc-100 mb-4">
              Editar informações
            </h2>
            <div className="space-y-3">
              {[
                { key: "name", label: "Nome", type: "text" },
                { key: "phone", label: "Telefone", type: "tel" },
                { key: "website", label: "Site", type: "url" },
                {
                  key: "instagramHandle",
                  label: "Instagram (sem @)",
                  type: "text",
                },
                { key: "city", label: "Cidade", type: "text" },
                { key: "state", label: "Estado", type: "text" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-500 mb-1">
                    {label}
                  </label>
                  <input
                    type={type}
                    value={editForm[key as keyof typeof editForm]}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={editPending || !editForm.name.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {editPending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

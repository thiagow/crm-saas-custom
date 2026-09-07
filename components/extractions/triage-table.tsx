"use client";

import { estimateDeepSearchCostUsd } from "@/lib/apify/cost";
import { deepEnrichResults, getEnrichmentStatus, validateEmails } from "@/lib/enrichment/actions";
import {
  discardResults,
  getTriageResults,
  promoteResultsToLeads,
  reactivateDiscardedResults,
  updateExtractionResult,
} from "@/lib/extractions/actions";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

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
  const [hasEmail, setHasEmail] = useState(false);
  const [hasWhatsapp, setHasWhatsapp] = useState(false);
  const [noSite, setNoSite] = useState(false);
  const [gbpUnclaimed, setGbpUnclaimed] = useState(false);
  const [hasOwner, setHasOwner] = useState(false);
  const [emailValidated, setEmailValidated] = useState(false);
  const [includeInstagram, setIncludeInstagram] = useState(false);
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
        hasEmail: hasEmail || undefined,
        hasWhatsapp: hasWhatsapp || undefined,
        noSite: noSite || undefined,
        gbpUnclaimed: gbpUnclaimed || undefined,
        hasOwner: hasOwner || undefined,
        emailValidated: emailValidated || undefined,
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
  }, [
    projectSlug,
    initialExtractionId,
    hasPhone,
    hasSite,
    hasInstagram,
    hasEmail,
    hasWhatsapp,
    noSite,
    gbpUnclaimed,
    hasOwner,
    emailValidated,
    minRating,
    orderBy,
  ]);

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
        const { promoted, alreadyExisted } = await promoteResultsToLeads({
          projectSlug,
          resultIds: Array.from(selected),
          stageId: targetStageId,
        });
        toast.success(
          alreadyExisted > 0
            ? `${promoted} leads criados · ${alreadyExisted} já existiam`
            : `${promoted} leads criados no Kanban`,
        );
        await loadResults();
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Erro ao promover leads");
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

  // ─── "Pesquisa profunda" (CNPJ/QSA owner lookup) ─────────────────────────────
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const pollDeepSearchStatus = useCallback(
    (ids: string[]) => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      const startedAt = Date.now();

      pollIntervalRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 3 * 60 * 1000) {
          clearInterval(pollIntervalRef.current);
          return;
        }
        try {
          const statuses = await getEnrichmentStatus({ projectSlug, resultIds: ids });
          setResults((prev) =>
            prev.map((r) => {
              const s = statuses.find((x) => x.id === r.id);
              return s ? { ...r, ...s } : r;
            }),
          );
          const stillInFlight = statuses.some(
            (s) =>
              s.deepStatus === "queued" ||
              s.deepStatus === "running" ||
              s.instagramDeepStatus === "queued" ||
              s.instagramDeepStatus === "running" ||
              s.emailValidationStatus === "queued",
          );
          if (!stillInFlight) clearInterval(pollIntervalRef.current);
        } catch {
          clearInterval(pollIntervalRef.current);
        }
      }, 4000);
    },
    [projectSlug],
  );

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  function runDeepSearch(resultIds: string[], instagram: boolean) {
    if (resultIds.length === 0) return;
    setResults((prev) =>
      prev.map((r) =>
        resultIds.includes(r.id)
          ? { ...r, deepStatus: "queued", ...(instagram ? { instagramDeepStatus: "queued" } : {}) }
          : r,
      ),
    );
    startTransition(async () => {
      try {
        const { queued, skipped } = await deepEnrichResults({ projectSlug, resultIds, instagram });
        if (queued > 0) {
          toast.success(
            queued === 1
              ? "Pesquisa profunda iniciada"
              : `Pesquisa profunda iniciada para ${queued} resultados`,
          );
          pollDeepSearchStatus(resultIds);
        }
        if (skipped > 0 && queued === 0) {
          toast.info("Já em andamento");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao iniciar pesquisa profunda");
      }
    });
  }

  // ─── Validação de e-mail (Bouncer) ────────────────────────────────────────────
  function runValidateEmails(resultIds: string[]) {
    if (resultIds.length === 0) return;
    setResults((prev) =>
      prev.map((r) => (resultIds.includes(r.id) ? { ...r, emailValidationStatus: "queued" } : r)),
    );
    startTransition(async () => {
      try {
        const { queued, skipped } = await validateEmails({ projectSlug, resultIds });
        if (queued > 0) {
          toast.success(
            queued === 1 ? "Validação de e-mail iniciada" : `Validando ${queued} e-mails`,
          );
          pollDeepSearchStatus(resultIds);
        }
        if (skipped > 0 && queued === 0) {
          toast.info("Nada para validar — selecione resultados com e-mail");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao validar e-mails");
      }
    });
  }

  // Discarding used to be irreversible: the unique index on (project_id, place_id) makes
  // every future extraction skip a discarded place, so it could never come back on its own.
  function handleReactivate() {
    startTransition(async () => {
      try {
        const { restored } = await reactivateDiscardedResults({
          projectSlug,
          ...(initialExtractionId ? { extractionId: initialExtractionId } : {}),
        });
        if (restored === 0) {
          toast.info("Nenhum resultado descartado para reativar");
        } else {
          toast.success(`${restored} resultado(s) devolvido(s) para a triagem`);
          await loadResults();
        }
      } catch {
        toast.error("Erro ao reativar descartados");
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

          {selected.size === 0 && (
            <button
              type="button"
              onClick={handleReactivate}
              title="Devolve resultados descartados para a triagem. Sem isso eles ficam presos: uma nova extração nunca os traz de volta."
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
            >
              Reativar descartados
            </button>
          )}

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
              <label
                className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none"
                title={`Também busca bio/seguidores do Instagram — 1 requisição paga por resultado (até US$ ${estimateDeepSearchCostUsd(selected.size, { instagram: true }).toFixed(2)} no total)`}
              >
                <input
                  type="checkbox"
                  checked={includeInstagram}
                  onChange={(e) => setIncludeInstagram(e.target.checked)}
                  className="accent-indigo-500"
                />
                + Instagram (~US${" "}
                {estimateDeepSearchCostUsd(selected.size, { instagram: true }).toFixed(2)})
              </label>
              <button
                type="button"
                onClick={() => runDeepSearch(Array.from(selected), includeInstagram)}
                title="Busca nome do dono/responsável via CNPJ (Receita Federal), opcionalmente + bio do Instagram"
                className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:border-indigo-700 hover:text-indigo-300 transition-colors"
              >
                Pesquisa profunda ({selected.size})
              </button>
              <button
                type="button"
                onClick={() => runValidateEmails(Array.from(selected))}
                title="Valida os e-mails encontrados via Bouncer antes de usá-los numa cadência — protege a reputação do domínio de envio"
                className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:border-emerald-700 hover:text-emerald-300 transition-colors"
              >
                Validar e-mails
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
            { label: "Tem WhatsApp", value: hasWhatsapp, set: setHasWhatsapp },
            { label: "Tem e-mail", value: hasEmail, set: setHasEmail },
            { label: "Tem telefone", value: hasPhone, set: setHasPhone },
            { label: "Tem Instagram", value: hasInstagram, set: setHasInstagram },
            {
              label: "Tem site",
              value: hasSite,
              set: (v: boolean) => {
                setHasSite(v);
                if (v) setNoSite(false);
              },
            },
            {
              label: "Sem site",
              value: noSite,
              set: (v: boolean) => {
                setNoSite(v);
                if (v) setHasSite(false);
              },
            },
            { label: "GMN não reivindicado", value: gbpUnclaimed, set: setGbpUnclaimed },
            { label: "Tem dono", value: hasOwner, set: setHasOwner },
            { label: "E-mail validado", value: emailValidated, set: setEmailValidated },
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
              onChange={(e) => setMinRating(e.target.value ? Number(e.target.value) : undefined)}
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
      <div className="flex-1 overflow-auto overflow-x-auto">
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
          <table className="w-full min-w-[1100px] text-sm">
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
                  Telefone
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  WhatsApp
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  E-mail
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Site
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Instagram
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Rating
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Google Meu Negócio
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Dono
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
                    selected.has(result.id) ? "bg-indigo-500/5" : "hover:bg-zinc-900/50",
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
                  <td className="p-3 whitespace-nowrap">
                    {result.phone ? (
                      <span className="text-xs text-zinc-300">{result.phone}</span>
                    ) : (
                      <span className="text-xs text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {result.whatsappNumber ? (
                      <a
                        href={`https://wa.me/${result.whatsappNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={
                          result.whatsappStatus === "likely"
                            ? "Provável WhatsApp — heurística pelo formato do número, não verificado"
                            : "Número de WhatsApp"
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        Abrir
                        {result.whatsappStatus === "likely" && (
                          <span className="text-emerald-600/80">?</span>
                        )}
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {result.email ? (
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`mailto:${result.email}`}
                          onClick={(e) => e.stopPropagation()}
                          title={result.email}
                          className="text-xs text-zinc-300 hover:text-indigo-400 truncate block max-w-40 transition-colors"
                        >
                          {result.email}
                        </a>
                        {result.emailValidationStatus === "queued" && (
                          <span
                            title="Validando…"
                            className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500"
                          />
                        )}
                        {result.emailValidationStatus === "deliverable" && (
                          <span title="Bouncer: entregável" className="shrink-0 text-emerald-500">
                            ✓
                          </span>
                        )}
                        {result.emailValidationStatus === "undeliverable" && (
                          <span
                            title={`Bouncer: não entregável${result.emailValidationReason ? ` (${result.emailValidationReason})` : ""}`}
                            className="shrink-0 text-red-500"
                          >
                            ✕
                          </span>
                        )}
                        {result.emailValidationStatus === "risky" && (
                          <span
                            title={`Bouncer: arriscado${result.emailValidationReason ? ` (${result.emailValidationReason})` : ""}`}
                            className="shrink-0 text-amber-500"
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {result.website ? (
                      <a
                        href={result.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={result.website}
                        className="text-xs text-indigo-400 hover:text-indigo-300 truncate block max-w-40"
                      >
                        {result.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
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
                  <td className="p-3 whitespace-nowrap">
                    {result.gbpStatus === "unclaimed" ? (
                      <span
                        title="Perfil sem dono no Google Meu Negócio — oportunidade de abordagem"
                        className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400"
                      >
                        Não reivindicado
                      </span>
                    ) : result.gbpStatus === "claimed" ? (
                      <span className="text-xs text-zinc-500">Reivindicado</span>
                    ) : (
                      <span className="text-xs text-zinc-700">—</span>
                    )}
                    {result.googleMapsUrl && (
                      <a
                        href={result.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block text-[11px] text-zinc-600 hover:text-indigo-400 transition-colors mt-0.5"
                      >
                        Ver no Maps ↗
                      </a>
                    )}
                  </td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    {result.ownerName ? (
                      <div>
                        <p className="text-xs text-zinc-300">{result.ownerName}</p>
                        {result.ownerRole && (
                          <p className="text-[10px] text-zinc-600">{result.ownerRole}</p>
                        )}
                      </div>
                    ) : result.deepStatus === "queued" || result.deepStatus === "running" ? (
                      <span className="flex items-center gap-1.5 text-xs text-indigo-400">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
                        {result.deepStatus === "queued" ? "Na fila…" : "Buscando…"}
                      </span>
                    ) : result.deepStatus === "failed" || result.deepStatus === "partial" ? (
                      <button
                        type="button"
                        onClick={() => runDeepSearch([result.id], false)}
                        title={result.deepError ?? "Tentar de novo"}
                        className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                      >
                        Não encontrado · tentar de novo
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => runDeepSearch([result.id], false)}
                        className="text-xs text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-indigo-400 transition-all"
                      >
                        Pesquisa profunda
                      </button>
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
          <div className="fixed inset-0 z-40 bg-black/60" onClick={closeEditModal} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-zinc-100 mb-4">Editar informações</h2>
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
                  <label className="block text-xs text-zinc-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={editForm[key as keyof typeof editForm]}
                    onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
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

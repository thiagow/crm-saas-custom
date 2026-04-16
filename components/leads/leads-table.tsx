"use client";

import { useState, useRef, useTransition } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { importLeadsFromCsv } from "@/lib/leads/csv-import";
import { createLead } from "@/lib/leads/actions";
import { cn } from "@/lib/utils";
import type { leads, pipelineStages } from "@/db/schema";

type Lead = typeof leads.$inferSelect & { stage: typeof pipelineStages.$inferSelect };
type Stage = typeof pipelineStages.$inferSelect;

const SOURCE_LABELS: Record<string, string> = {
  google_maps: "Maps",
  csv_import: "CSV",
  manual: "Manual",
};

interface LeadsTableProps {
  leads: Lead[];
  stages: Stage[];
  projectSlug: string;
}

export function LeadsTable({ leads, stages, projectSlug }: LeadsTableProps) {
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({
    name: "",
    company: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    instagram: "",
  });
  const [targetStageId, setTargetStageId] = useState(stages[0]?.id ?? "");
  const [showCsvModal, setShowCsvModal] = useState(false);

  // New lead modal state
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    instagramHandle: "",
    value: "",
  });

  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length === 0) {
          toast.error("Arquivo CSV vazio ou inválido");
          return;
        }
        const headers = Object.keys(results.data[0] ?? {});
        setCsvHeaders(headers);
        setCsvRows(results.data as Array<Record<string, string>>);
        // Auto-map common column names
        setColumnMap({
          name: headers.find((h) => /nome|name/i.test(h)) ?? "",
          company: headers.find((h) => /empresa|company/i.test(h)) ?? "",
          phone: headers.find((h) => /telefone|phone|tel|cel/i.test(h)) ?? "",
          email: headers.find((h) => /email|e-mail/i.test(h)) ?? "",
          city: headers.find((h) => /cidade|city/i.test(h)) ?? "",
          state: headers.find((h) => /estado|state|uf/i.test(h)) ?? "",
          instagram: headers.find((h) => /instagram|ig/i.test(h)) ?? "",
        });
        setShowCsvModal(true);
      },
      error: () => toast.error("Erro ao ler arquivo CSV"),
    });
  }

  function handleImport() {
    if (!columnMap["name"]) {
      toast.error("Mapeie pelo menos a coluna de nome");
      return;
    }

    startTransition(async () => {
      try {
        const result = await importLeadsFromCsv({
          projectSlug,
          stageId: targetStageId,
          rows: csvRows,
          columnMap: columnMap as Parameters<typeof importLeadsFromCsv>[0]["columnMap"],
        });
        toast.success(`${result.imported} leads importados, ${result.skipped} ignorados`);
        if (result.errors.length > 0) {
          toast.warning(`${result.errors.length} erros — veja o console`);
          console.warn("CSV import errors:", result.errors);
        }
        setShowCsvModal(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro na importação");
      }
    });
  }

  function downloadTemplate() {
    const headers = ["Nome", "Empresa", "Telefone", "Email", "Cidade", "Estado", "Instagram"];
    const example = ["João Silva", "Academia Fight Club", "(11) 99999-0000", "joao@academia.com", "São Paulo", "SP", "@joao.silva"];
    const csv = [headers.join(","), example.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCreateLead() {
    startTransition(async () => {
      try {
        if (!newLeadForm.name.trim()) {
          toast.error("Nome é obrigatório");
          return;
        }
        await createLead({
          projectSlug,
          stageId: targetStageId,
          name: newLeadForm.name,
          company: newLeadForm.company || undefined,
          phone: newLeadForm.phone || undefined,
          email: newLeadForm.email || undefined,
          city: newLeadForm.city || undefined,
          state: newLeadForm.state || undefined,
          instagramHandle: newLeadForm.instagramHandle || undefined,
          value: newLeadForm.value ? parseFloat(newLeadForm.value) : undefined,
        });
        toast.success("Lead criado");
        setShowNewLeadModal(false);
        setNewLeadForm({
          name: "",
          company: "",
          phone: "",
          email: "",
          city: "",
          state: "",
          instagramHandle: "",
          value: "",
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao criar lead");
      }
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Leads</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{leads.length} leads no projeto</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => setShowNewLeadModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            Novo lead
          </button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 11l3 3m0 0l3-3m-3 3V3" />
            </svg>
            Template CSV
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Importar CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-zinc-500">Nenhum lead ainda.</p>
            <p className="text-xs text-zinc-700 mt-1">
              Importe um CSV, use o extrator Google Maps ou adicione manualmente no Kanban.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-800 text-left">
                {["Empresa/Nome", "Contato", "Localização", "Estágio", "Fonte"].map((h) => (
                  <th key={h} className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="p-3">
                    <p className="font-medium text-zinc-200">{lead.company ?? lead.name}</p>
                    {lead.company && <p className="text-xs text-zinc-500">{lead.name}</p>}
                  </td>
                  <td className="p-3 text-xs text-zinc-400 space-y-0.5">
                    {lead.phone && <p>{lead.phone}</p>}
                    {lead.instagramHandle && <p>@{lead.instagramHandle}</p>}
                  </td>
                  <td className="p-3 text-xs text-zinc-400">
                    {lead.city}{lead.state ? `, ${lead.state}` : ""}
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                      <div
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: lead.stage.color }}
                      />
                      {lead.stage.name}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-xs text-zinc-600">
                      {SOURCE_LABELS[lead.source] ?? lead.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CSV column mapping modal */}
      {showCsvModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowCsvModal(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-base font-semibold text-zinc-100 mb-1">Mapeamento de colunas</h2>
            <p className="text-xs text-zinc-500 mb-4">
              {csvRows.length} linhas encontradas. Associe as colunas do seu CSV.
            </p>

            <div className="space-y-3 mb-4">
              {[
                { key: "name", label: "Nome*", required: true },
                { key: "company", label: "Empresa" },
                { key: "phone", label: "Telefone" },
                { key: "email", label: "Email" },
                { key: "city", label: "Cidade" },
                { key: "state", label: "Estado (UF)" },
                { key: "instagram", label: "Instagram" },
              ].map(({ key, label, required }) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="w-28 text-xs font-medium text-zinc-400 flex-shrink-0">
                    {label}
                  </label>
                  <select
                    value={columnMap[key] ?? ""}
                    onChange={(e) =>
                      setColumnMap((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className={cn(
                      "flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500",
                      required && !columnMap[key] && "border-red-800",
                    )}
                  >
                    <option value="">— não mapear —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Estágio de destino
              </label>
              <select
                value={targetStageId}
                onChange={(e) => setTargetStageId(e.target.value)}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Preview */}
            {csvRows[0] && (
              <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Prévia (linha 1)</p>
                <div className="text-xs text-zinc-400 space-y-0.5">
                  <p>Nome: <span className="text-zinc-200">{columnMap["name"] ? csvRows[0][columnMap["name"]] : "—"}</span></p>
                  <p>Telefone: <span className="text-zinc-200">{columnMap["phone"] ? csvRows[0][columnMap["phone"]] : "—"}</span></p>
                  <p>Cidade: <span className="text-zinc-200">{columnMap["city"] ? csvRows[0][columnMap["city"]] : "—"}</span></p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="flex-1 rounded-lg border border-zinc-800 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!columnMap["name"]}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Importar {csvRows.length} leads
              </button>
            </div>
          </div>
        </>
      )}

      {/* New lead modal */}
      {showNewLeadModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowNewLeadModal(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-base font-semibold text-zinc-100 mb-4">Novo lead</h2>

            <div className="space-y-3 mb-6">
              {[
                { key: "name", label: "Nome*", type: "text" },
                { key: "company", label: "Empresa", type: "text" },
                { key: "phone", label: "Telefone", type: "tel" },
                { key: "email", label: "Email", type: "email" },
                { key: "city", label: "Cidade", type: "text" },
                { key: "state", label: "Estado (UF)", type: "text" },
                { key: "instagramHandle", label: "Instagram", type: "text" },
                { key: "value", label: "Valor (R$)", type: "number" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    {label}
                  </label>
                  <input
                    type={type}
                    placeholder={label}
                    value={newLeadForm[key as keyof typeof newLeadForm]}
                    onChange={(e) =>
                      setNewLeadForm((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Estágio
                </label>
                <select
                  value={targetStageId}
                  onChange={(e) => setTargetStageId(e.target.value)}
                  className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowNewLeadModal(false)}
                className="flex-1 rounded-lg border border-zinc-800 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateLead}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Criar lead
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

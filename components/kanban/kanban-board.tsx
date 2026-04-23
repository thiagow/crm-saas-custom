"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { getKanbanData } from "@/lib/leads/actions";
import { moveLead, createLead } from "@/lib/leads/actions";
import { formatPhoneNumber } from "@/lib/phone-mask";
import { KanbanColumn } from "./kanban-column";
import { LeadCard } from "./lead-card";
import { cn } from "@/lib/utils";

type KanbanData = Awaited<ReturnType<typeof getKanbanData>>;
type Lead = KanbanData["leads"][number];
type Stage = KanbanData["stages"][number];

interface KanbanBoardProps {
  initialData: KanbanData;
  projectSlug: string;
}

export function KanbanBoard({ initialData, projectSlug }: KanbanBoardProps) {
  const [stages] = useState<Stage[]>(initialData.stages);
  const [leadsMap, setLeadsMap] = useState<Record<string, Lead[]>>(() => {
    const map: Record<string, Lead[]> = {};
    for (const stage of initialData.stages) {
      map[stage.id] = [];
    }
    for (const lead of initialData.leads) {
      if (!map[lead.stageId]) map[lead.stageId] = [];
      map[lead.stageId]!.push(lead);
    }
    return map;
  });

  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedStageForCreate, setSelectedStageForCreate] = useState<string>("");
  const [newLeadForm, setNewLeadForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
    website: "",
    city: "",
    state: "",
    instagramHandle: "",
    value: "",
  });
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // Prevent accidental drags
    }),
  );

  function openCreateModal() {
    setShowCreateModal(true);
    setSelectedStageForCreate(stages[0]?.id ?? "");
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setNewLeadForm({
      name: "",
      company: "",
      phone: "",
      email: "",
      website: "",
      city: "",
      state: "",
      instagramHandle: "",
      value: "",
    });
  }

  function handleCreateLead() {
    startTransition(async () => {
      try {
        if (!newLeadForm.name.trim()) {
          toast.error("Nome é obrigatório");
          return;
        }
        const newLead = await createLead({
          projectSlug,
          stageId: selectedStageForCreate,
          name: newLeadForm.name,
          company: newLeadForm.company || undefined,
          phone: newLeadForm.phone || undefined,
          email: newLeadForm.email || undefined,
          website: newLeadForm.website || undefined,
          city: newLeadForm.city || undefined,
          state: newLeadForm.state || undefined,
          instagramHandle: newLeadForm.instagramHandle || undefined,
          value: newLeadForm.value ? parseFloat(newLeadForm.value) : undefined,
        });

        // Add to leadsMap optimistically
        const targetStageId = selectedStageForCreate;
        setLeadsMap((prev) => ({
          ...prev,
          [targetStageId]: [
            ...(prev[targetStageId] ?? []),
            {
              ...newLead,
              stage: stages.find((s) => s.id === targetStageId)!,
              activities: [],
            },
          ],
        }));

        toast.success("Lead criado");
        closeCreateModal();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao criar lead");
      }
    });
  }

  function onDragStart({ active }: DragStartEvent) {
    const lead = initialData.leads.find((l) => l.id === active.id);
    if (lead) setActiveLead(lead);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveLead(null);
    if (!over) return;

    const leadId = active.id as string;
    const targetStageId = over.id as string;

    // Find current stage
    let currentStageId: string | undefined;
    for (const [stageId, stageLeads] of Object.entries(leadsMap)) {
      if (stageLeads.some((l) => l.id === leadId)) {
        currentStageId = stageId;
        break;
      }
    }

    if (!currentStageId || currentStageId === targetStageId) return;

    // Optimistic update
    setLeadsMap((prev) => {
      const updated = { ...prev };
      const movingLead = updated[currentStageId!]?.find((l) => l.id === leadId);
      if (!movingLead) return prev;

      updated[currentStageId!] = updated[currentStageId!]!.filter((l) => l.id !== leadId);
      updated[targetStageId] = [
        ...(updated[targetStageId] ?? []),
        { ...movingLead, stageId: targetStageId },
      ];
      return updated;
    });

    // Persist
    startTransition(async () => {
      try {
        await moveLead({ leadId, stageId: targetStageId, projectSlug });
      } catch {
        toast.error("Erro ao mover lead. Tente novamente.");
        // Revert — reload data
        window.location.reload();
      }
    });
  }

  function handleLeadCreated(stageId: string, lead: Lead) {
    setLeadsMap((prev) => ({
      ...prev,
      [stageId]: [...(prev[stageId] ?? []), lead],
    }));
  }

  return (
    <>
      {/* Header with create button */}
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Kanban</h2>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
          Novo Lead
        </button>
      </div>

      <div className="flex h-full gap-3 overflow-x-auto p-4">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <SortableContext items={stages.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
            {stages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                leads={leadsMap[stage.id] ?? []}
                projectSlug={projectSlug}
                onLeadClick={setSelectedLead}
                onLeadCreated={(lead) => handleLeadCreated(stage.id, lead)}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeLead && (
              <LeadCard lead={activeLead} isDragging />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Lead drawer */}
      {selectedLead && (
        <LeadDrawerWrapper
          lead={selectedLead}
          projectSlug={projectSlug}
          onClose={() => setSelectedLead(null)}
        />
      )}

      {/* Create lead modal */}
      {showCreateModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={closeCreateModal} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-base font-semibold text-zinc-100 mb-4">Novo lead</h2>

            <div className="space-y-3 mb-6">
              {[
                { key: "name", label: "Nome*", type: "text" },
                { key: "company", label: "Empresa", type: "text" },
                { key: "phone", label: "WhatsApp", type: "tel" },
                { key: "email", label: "Email", type: "email" },
                { key: "website", label: "Site", type: "url" },
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
                    onChange={(e) => {
                      let value = e.target.value;
                      if (key === "phone") {
                        value = formatPhoneNumber(value);
                      }
                      setNewLeadForm((prev) => ({ ...prev, [key]: value }));
                    }}
                    className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Estágio
                </label>
                <select
                  value={selectedStageForCreate}
                  onChange={(e) => setSelectedStageForCreate(e.target.value)}
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
                onClick={closeCreateModal}
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
    </>
  );
}

// Dynamic import to keep initial bundle small
import dynamic from "next/dynamic";
const LeadDrawerWrapper = dynamic(
  () => import("./lead-drawer").then((m) => m.LeadDrawer),
  { ssr: false },
);

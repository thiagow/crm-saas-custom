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
import { moveLead } from "@/lib/leads/actions";
import { KanbanColumn } from "./kanban-column";
import { LeadCard } from "./lead-card";

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
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // Prevent accidental drags
    }),
  );

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
    </>
  );
}

// Dynamic import to keep initial bundle small
import dynamic from "next/dynamic";
const LeadDrawerWrapper = dynamic(
  () => import("./lead-drawer").then((m) => m.LeadDrawer),
  { ssr: false },
);

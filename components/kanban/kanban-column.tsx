"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { getKanbanData } from "@/lib/leads/actions";
import { cn } from "@/lib/utils";
import { LeadCard } from "./lead-card";

type Stage = Awaited<ReturnType<typeof getKanbanData>>["stages"][number];
type Lead = Awaited<ReturnType<typeof getKanbanData>>["leads"][number];

interface KanbanColumnProps {
  stage: Stage;
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
}

export function KanbanColumn({ stage, leads, onLeadClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex flex-shrink-0 flex-col w-64">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <div
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          {stage.name}
        </span>
        <span className="ml-auto text-xs text-zinc-600 font-mono">{leads.length}</span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-2 rounded-lg p-2 min-h-20 transition-colors",
          isOver ? "bg-zinc-800/50 ring-1 ring-indigo-500/30" : "bg-zinc-900/30",
        )}
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-6">
            <span className="text-xs text-zinc-700">Nenhum lead</span>
          </div>
        )}
      </div>
    </div>
  );
}

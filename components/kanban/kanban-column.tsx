"use client";

import { useRef, useState, useTransition } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { toast } from "sonner";
import type { getKanbanData } from "@/lib/leads/actions";
import { createLead } from "@/lib/leads/actions";
import { cn } from "@/lib/utils";
import { LeadCard } from "./lead-card";

type Stage = Awaited<ReturnType<typeof getKanbanData>>["stages"][number];
type Lead = Awaited<ReturnType<typeof getKanbanData>>["leads"][number];

interface KanbanColumnProps {
  stage: Stage;
  leads: Lead[];
  projectSlug: string;
  onLeadClick: (lead: Lead) => void;
  onLeadCreated: (lead: Lead) => void;
}

export function KanbanColumn({ stage, leads, projectSlug, onLeadClick, onLeadCreated }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [showAdd, setShowAdd] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleAddLead() {
    startTransition(async () => {
      try {
        if (!newLeadName.trim()) {
          toast.error("Digite um nome para o lead");
          return;
        }
        const lead = await createLead({
          projectSlug,
          stageId: stage.id,
          name: newLeadName.trim(),
        });
        onLeadCreated({ ...lead, activities: [] });
        setNewLeadName("");
        setShowAdd(false);
        toast.success("Lead criado");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao criar lead");
      }
    });
  }

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

        {/* Quick add form */}
        {showAdd && (
          <div className="flex gap-1 mt-1">
            <input
              ref={inputRef}
              type="text"
              placeholder="Nome do lead…"
              value={newLeadName}
              onChange={(e) => setNewLeadName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddLead();
                if (e.key === "Escape") {
                  setShowAdd(false);
                  setNewLeadName("");
                }
              }}
              autoFocus
              disabled={isPending}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={handleAddLead}
              disabled={isPending}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded text-xs font-medium text-white transition-colors"
            >
              {isPending ? "…" : "+"}
            </button>
          </div>
        )}

        {!showAdd && (
          <button
            onClick={() => {
              setShowAdd(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors mt-1 py-1 px-2"
          >
            + Novo lead
          </button>
        )}
      </div>
    </div>
  );
}

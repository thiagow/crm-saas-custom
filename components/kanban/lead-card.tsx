"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { getKanbanData } from "@/lib/leads/actions";
import { cn } from "@/lib/utils";

type Lead = Awaited<ReturnType<typeof getKanbanData>>["leads"][number];

const SOURCE_LABELS: Record<string, string> = {
  google_maps: "Maps",
  csv_import: "CSV",
  manual: "Manual",
};

interface LeadCardProps {
  lead: Lead;
  isDragging?: boolean;
  onClick?: () => void;
}

export function LeadCard({ lead, isDragging, onClick }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging } =
    useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "group rounded-lg border border-zinc-800 bg-zinc-900 p-3 cursor-pointer transition-all select-none",
        "hover:border-zinc-700 hover:bg-zinc-800/80",
        (isDragging || isSortableDragging) && "opacity-40 shadow-xl ring-1 ring-indigo-500/50",
      )}
    >
      {/* Name / Company */}
      <div className="mb-2">
        <p className="text-sm font-medium text-zinc-100 leading-snug">
          {lead.company ?? lead.name}
        </p>
        {lead.company && (
          <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{lead.name}</p>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {lead.city && (
          <span className="inline-flex items-center text-[10px] text-zinc-600">
            <svg className="mr-0.5 h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            </svg>
            {lead.city}
          </span>
        )}
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-500">
          {SOURCE_LABELS[lead.source] ?? lead.source}
        </span>
        {lead.instagramHandle && (
          <span className="inline-flex items-center text-[10px] text-zinc-600">
            <svg className="mr-0.5 h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
            @{lead.instagramHandle}
          </span>
        )}
      </div>

      {/* Value */}
      {lead.value && (
        <div className="mt-2 text-right">
          <span className="text-xs font-medium text-zinc-400">
            R$ {lead.value.toLocaleString("pt-BR")}
          </span>
        </div>
      )}
    </div>
  );
}

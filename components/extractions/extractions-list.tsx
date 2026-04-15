"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";
import { getExtractionStatus } from "@/lib/extractions/actions";
import { cn } from "@/lib/utils";
import type { extractions } from "@/db/schema";

type Extraction = typeof extractions.$inferSelect;

const STATUS_CONFIG = {
  queued: { label: "Na fila", color: "text-zinc-500", dot: "bg-zinc-600" },
  running: { label: "Rodando", color: "text-amber-400", dot: "bg-amber-400 animate-pulse" },
  completed: { label: "Concluída", color: "text-green-400", dot: "bg-green-500" },
  failed: { label: "Falhou", color: "text-red-400", dot: "bg-red-500" },
  cancelled: { label: "Cancelada", color: "text-zinc-600", dot: "bg-zinc-700" },
};

function ExtractionRow({
  extraction,
  projectSlug,
}: {
  extraction: Extraction;
  projectSlug: string;
}) {
  const [status, setStatus] = useState(extraction);
  const isActive = status.status === "queued" || status.status === "running";

  // Poll for status updates on active extractions
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(async () => {
      const updated = await getExtractionStatus(extraction.id, projectSlug);
      if (updated) {
        setStatus(updated);
        if (updated.status !== "queued" && updated.status !== "running") {
          clearInterval(interval);
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [extraction.id, projectSlug, isActive]);

  const config = STATUS_CONFIG[status.status];

  return (
    <div className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className={cn("h-2 w-2 rounded-full flex-shrink-0", config.dot)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate">
          {status.query} — {status.city}, {status.state}
        </p>
        <p className="text-xs text-zinc-600 mt-0.5">
          {formatDistanceToNow(new Date(status.createdAt), { addSuffix: true, locale: ptBR })}
          {status.totalFound > 0 && ` · ${status.totalFound} encontrados`}
          {(status.costUsd ?? 0) > 0 && ` · $${status.costUsd?.toFixed(2)} USD`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className={cn("text-xs font-medium", config.color)}>{config.label}</span>
        {status.status === "completed" && (
          <Link
            href={`/${projectSlug}/triage?extractionId=${status.id}`}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Ver triagem →
          </Link>
        )}
      </div>
    </div>
  );
}

export function ExtractionsList({
  extractions,
  projectSlug,
}: {
  extractions: Extraction[];
  projectSlug: string;
}) {
  if (extractions.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
        <p className="text-sm text-zinc-500">Nenhuma extração ainda.</p>
        <p className="text-xs text-zinc-700 mt-1">
          Use "Nova extração" para descobrir empresas via Google Maps.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {extractions.map((extraction) => (
        <ExtractionRow key={extraction.id} extraction={extraction} projectSlug={projectSlug} />
      ))}
    </div>
  );
}

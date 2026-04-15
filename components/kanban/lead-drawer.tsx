"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { addActivity, getLeadDetails } from "@/lib/leads/actions";
import type { getKanbanData } from "@/lib/leads/actions";
import { cn } from "@/lib/utils";

type Lead = Awaited<ReturnType<typeof getKanbanData>>["leads"][number];
type LeadDetails = Awaited<ReturnType<typeof getLeadDetails>>;

type ActivityType = "note" | "call" | "email" | "whatsapp" | "instagram_dm" | "meeting";

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  note: "Nota",
  call: "Ligação",
  email: "Email",
  whatsapp: "WhatsApp",
  instagram_dm: "Instagram DM",
  meeting: "Reunião",
};

const ACTIVITY_ICONS: Record<ActivityType, string> = {
  note: "📝",
  call: "📞",
  email: "✉️",
  whatsapp: "💬",
  instagram_dm: "📸",
  meeting: "🤝",
};

interface LeadDrawerProps {
  lead: Lead;
  projectSlug: string;
  onClose: () => void;
}

export function LeadDrawer({ lead, projectSlug, onClose }: LeadDrawerProps) {
  const [details, setDetails] = useState<LeadDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityType, setActivityType] = useState<ActivityType>("note");
  const [content, setContent] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    getLeadDetails(lead.id, projectSlug)
      .then(setDetails)
      .catch(() => toast.error("Erro ao carregar detalhes do lead"))
      .finally(() => setLoading(false));
  }, [lead.id, projectSlug]);

  function handleAddActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    const submittedContent = content.trim();
    setContent("");

    startTransition(async () => {
      try {
        await addActivity({
          leadId: lead.id,
          projectSlug,
          type: activityType,
          content: submittedContent,
        });
        // Refresh details
        const updated = await getLeadDetails(lead.id, projectSlug);
        setDetails(updated);
        toast.success("Atividade registrada");
      } catch {
        toast.error("Erro ao registrar atividade");
      }
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 p-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-zinc-100 truncate">
              {lead.company ?? lead.name}
            </h2>
            {lead.company && (
              <p className="text-sm text-zinc-500 truncate">{lead.name}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex-shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Contact info */}
        <div className="border-b border-zinc-800 p-4 grid grid-cols-2 gap-3">
          {lead.phone && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-0.5">Telefone</p>
              <a href={`tel:${lead.phone}`} className="text-sm text-zinc-300 hover:text-indigo-400 transition-colors">
                {lead.phone}
              </a>
            </div>
          )}
          {lead.email && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-0.5">Email</p>
              <a href={`mailto:${lead.email}`} className="text-sm text-zinc-300 hover:text-indigo-400 transition-colors truncate block">
                {lead.email}
              </a>
            </div>
          )}
          {lead.website && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-0.5">Site</p>
              <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-300 hover:text-indigo-400 transition-colors truncate block">
                {lead.website.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
          {lead.instagramHandle && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-0.5">Instagram</p>
              <a href={`https://instagram.com/${lead.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-300 hover:text-indigo-400 transition-colors">
                @{lead.instagramHandle}
              </a>
            </div>
          )}
          {lead.city && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-0.5">Localização</p>
              <p className="text-sm text-zinc-300">{lead.city}{lead.state ? `, ${lead.state}` : ""}</p>
            </div>
          )}
        </div>

        {/* Activity timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Timeline</h3>
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
            </div>
          )}
          {!loading && details && details.activities.length === 0 && (
            <p className="text-sm text-zinc-600 text-center py-6">Nenhuma atividade registrada.</p>
          )}
          {!loading && details && (
            <div className="space-y-3">
              {details.activities.map((activity) => (
                <div key={activity.id} className="flex gap-3">
                  <div className="flex-shrink-0 text-base leading-none mt-0.5">
                    {ACTIVITY_ICONS[activity.type as ActivityType] ?? "•"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-zinc-400">
                        {ACTIVITY_LABELS[activity.type as ActivityType] ?? activity.type}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {format(new Date(activity.occurredAt), "d MMM, HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                    {activity.content && (
                      <p className="text-sm text-zinc-300 leading-relaxed">{activity.content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add activity form */}
        <div className="border-t border-zinc-800 p-4">
          <form onSubmit={handleAddActivity} className="space-y-2">
            <div className="flex gap-1 flex-wrap">
              {(Object.keys(ACTIVITY_LABELS) as ActivityType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setActivityType(type)}
                  className={cn(
                    "px-2 py-1 rounded text-xs transition-colors",
                    activityType === type
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700",
                  )}
                >
                  {ACTIVITY_LABELS[type]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`Registrar ${ACTIVITY_LABELS[activityType].toLowerCase()}...`}
                rows={2}
                maxLength={2000}
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none transition-colors"
              />
              <button
                type="submit"
                disabled={!content.trim()}
                className="flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Salvar
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

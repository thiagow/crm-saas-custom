"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { archiveProject } from "@/lib/projects/actions";
import { updateProjectSettings } from "@/lib/projects/settings-actions";

interface Stage {
  id: string;
  name: string;
  order: number;
  color: string;
}

interface Member {
  id: string;
  role: string;
  user: { id: string; name: string | null; email: string | null };
}

interface Project {
  id: string;
  slug: string;
  name: string;
  type: "B2B" | "B2C";
  description: string | null;
}

interface Props {
  project: Project;
  stages: Stage[];
  members: Member[];
}

export function SettingsForm({ project, stages, members }: Props) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [, startTransition] = useTransition();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateProjectSettings({ projectId: project.id, name, description });
        toast.success("Configurações salvas.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  function handleArchive() {
    startTransition(async () => {
      try {
        await archiveProject(project.id);
        toast.success("Projeto arquivado.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao arquivar");
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* General settings */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Geral</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">
              Nome do projeto
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">
              Descrição{" "}
              <span className="text-zinc-600 font-normal">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              rows={3}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">
              Tipo:{" "}
              <span className="font-medium text-zinc-300">{project.type}</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-sm text-zinc-500">
              Slug:{" "}
              <span className="font-mono text-zinc-300">{project.slug}</span>
            </span>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Salvar
            </button>
          </div>
        </form>
      </section>

      {/* Pipeline stages (read-only in MVP) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">
          Estágios do funil
        </h2>
        <div className="space-y-2">
          {stages.map((stage) => (
            <div
              key={stage.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
            >
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: stage.color }}
              />
              <span className="text-sm text-zinc-300">{stage.name}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Edição de estágios estará disponível em breve.
        </p>
      </section>

      {/* Members */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Membros</h2>
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5"
            >
              <div>
                <p className="text-sm text-zinc-200">
                  {member.user.name ?? member.user.email ?? "—"}
                </p>
                {member.user.name && (
                  <p className="text-xs text-zinc-500">{member.user.email}</p>
                )}
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-400 capitalize">
                {member.role}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Convite de membros estará disponível em breve.
        </p>
      </section>

      {/* Danger zone */}
      <section className="rounded-xl border border-red-900/40 bg-zinc-950 p-6">
        <h2 className="text-sm font-semibold text-red-400 mb-2">Zona de perigo</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Arquivar o projeto oculta ele da lista. Os dados não são deletados.
        </p>
        {archiveConfirm ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">Confirma?</span>
            <button
              type="button"
              onClick={handleArchive}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 transition-colors"
            >
              Sim, arquivar
            </button>
            <button
              type="button"
              onClick={() => setArchiveConfirm(false)}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setArchiveConfirm(true)}
            className="rounded-lg border border-red-900/60 px-4 py-2 text-sm font-medium text-red-400 hover:border-red-700 hover:text-red-300 transition-colors"
          >
            Arquivar projeto
          </button>
        )}
      </section>
    </div>
  );
}

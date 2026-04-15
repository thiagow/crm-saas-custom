"use client";

import { archiveProject } from "@/lib/projects/actions";
import {
  addPipelineStage,
  deletePipelineStage,
  reorderPipelineStages,
  updatePipelineStage,
  updateProjectSettings,
} from "@/lib/projects/settings-actions";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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

export function SettingsForm({ project, stages: initialStages, members }: Props) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [stages, setStages] = useState<Stage[]>(initialStages);

  // Stage editing state
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [deletingStageId, setDeletingStageId] = useState<string | null>(null);

  // New stage form
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");

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

  function startEditStage(stage: Stage) {
    setEditingStageId(stage.id);
    setEditName(stage.name);
    setEditColor(stage.color);
  }

  function cancelEditStage() {
    setEditingStageId(null);
  }

  function handleSaveStage(stage: Stage) {
    startTransition(async () => {
      try {
        await updatePipelineStage({
          stageId: stage.id,
          projectId: project.id,
          name: editName,
          color: editColor,
        });
        setStages((prev) =>
          prev.map((s) => (s.id === stage.id ? { ...s, name: editName, color: editColor } : s)),
        );
        setEditingStageId(null);
        toast.success("Estágio atualizado.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
      }
    });
  }

  function handleDeleteStage(stageId: string) {
    startTransition(async () => {
      try {
        await deletePipelineStage({ stageId, projectId: project.id });
        setStages((prev) => prev.filter((s) => s.id !== stageId));
        setDeletingStageId(null);
        toast.success("Estágio removido.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao remover");
        setDeletingStageId(null);
      }
    });
  }

  function handleMoveStage(stageId: string, direction: "up" | "down") {
    const idx = stages.findIndex((s) => s.id === stageId);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === stages.length - 1) return;

    const newStages = [...stages];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const a = newStages[idx];
    const b = newStages[swapIdx];
    if (!a || !b) return;
    newStages[idx] = b;
    newStages[swapIdx] = a;

    setStages(newStages);
    startTransition(async () => {
      try {
        await reorderPipelineStages({
          projectId: project.id,
          orderedIds: newStages.map((s) => s.id),
        });
      } catch (err) {
        // Revert on failure
        setStages(stages);
        toast.error(err instanceof Error ? err.message : "Erro ao reordenar");
      }
    });
  }

  function handleAddStage(e: React.FormEvent) {
    e.preventDefault();
    if (!newStageName.trim()) return;
    startTransition(async () => {
      try {
        await addPipelineStage({
          projectId: project.id,
          name: newStageName.trim(),
          color: newStageColor,
        });
        // Refresh stages list from server via revalidatePath
        setAddingStage(false);
        setNewStageName("");
        setNewStageColor("#6366f1");
        toast.success("Estágio adicionado.");
        // Reload the page to get updated stages list
        window.location.reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao adicionar");
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
            <label
              htmlFor="project-name"
              className="block text-sm font-medium text-zinc-400 mb-1.5"
            >
              Nome do projeto
            </label>
            <input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label
              htmlFor="project-description"
              className="block text-sm font-medium text-zinc-400 mb-1.5"
            >
              Descrição <span className="text-zinc-600 font-normal">(opcional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              rows={3}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">
              Tipo: <span className="font-medium text-zinc-300">{project.type}</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-sm text-zinc-500">
              Slug: <span className="font-mono text-zinc-300">{project.slug}</span>
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

      {/* Pipeline stages */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-300">Estágios do funil</h2>
          {!addingStage && (
            <button
              type="button"
              onClick={() => setAddingStage(true)}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Adicionar
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          {stages.map((stage, idx) => (
            <div key={stage.id}>
              {editingStageId === stage.id ? (
                /* Inline edit row */
                <div className="flex items-center gap-2 rounded-lg border border-indigo-700/60 bg-zinc-900 px-3 py-2">
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={60}
                    className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveStage(stage)}
                    className="flex h-6 w-6 items-center justify-center rounded text-green-500 hover:bg-zinc-800 transition-colors"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditStage}
                    className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 transition-colors"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : deletingStageId === stage.id ? (
                /* Confirm delete row */
                <div className="flex items-center justify-between rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2">
                  <span className="text-sm text-zinc-400">Deletar &ldquo;{stage.name}&rdquo;?</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteStage(stage.id)}
                      className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 transition-colors"
                    >
                      Deletar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingStageId(null)}
                      className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal row */
                <div className="group flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="flex-1 text-sm text-zinc-300">{stage.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleMoveStage(stage.id, "up")}
                      disabled={idx === 0}
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 disabled:opacity-30 transition-colors"
                    >
                      <ChevronUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveStage(stage.id, "down")}
                      disabled={idx === stages.length - 1}
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 disabled:opacity-30 transition-colors"
                    >
                      <ChevronDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditStage(stage)}
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingStageId(stage.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add stage form */}
        {addingStage && (
          <form
            onSubmit={handleAddStage}
            className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900 px-3 py-2"
          >
            <input
              type="color"
              value={newStageColor}
              onChange={(e) => setNewStageColor(e.target.value)}
              className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="Nome do estágio"
              maxLength={60}
              required
              className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            <button
              type="submit"
              className="flex h-6 w-6 items-center justify-center rounded text-green-500 hover:bg-zinc-800 transition-colors"
            >
              <CheckIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingStage(false);
                setNewStageName("");
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 transition-colors"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
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
                {member.user.name && <p className="text-xs text-zinc-500">{member.user.email}</p>}
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-400 capitalize">
                {member.role}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-600">Convite de membros estará disponível em breve.</p>
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

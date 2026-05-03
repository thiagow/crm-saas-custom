"use client";

import { setUserProjectAccess } from "@/lib/users/actions";
import { useTransition } from "react";
import { toast } from "sonner";

type ProjectRole = "owner" | "admin" | "sales" | "viewer";

type ProjectWithMembership = {
  id: string;
  name: string;
  slug: string;
  type: string;
  membership: { id: string; role: ProjectRole } | null;
};

interface Props {
  userId: string;
  projects: ProjectWithMembership[];
}

const ROLE_OPTIONS: { value: ProjectRole | "none"; label: string }[] = [
  { value: "none", label: "Sem acesso" },
  { value: "viewer", label: "Visualizador" },
  { value: "sales", label: "Vendas" },
  { value: "admin", label: "Admin" },
];

export function UserProjectsPanel({ userId, projects }: Props) {
  const [pending, startTransition] = useTransition();

  function handleRoleChange(projectId: string, value: string) {
    const role = value === "none" ? null : (value as ProjectRole);
    startTransition(async () => {
      try {
        await setUserProjectAccess({ targetUserId: userId, projectId, role });
        toast.success("Acesso atualizado.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao atualizar acesso");
      }
    });
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-sm font-semibold text-zinc-300 mb-1">Acesso a projetos</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Defina o papel deste usuário em cada projeto. &quot;Sem acesso&quot; remove o vínculo.
      </p>

      {projects.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum projeto cadastrado.</p>
      ) : (
        <div className="space-y-1.5">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{project.name}</p>
                <p className="text-xs text-zinc-600">{project.type}</p>
              </div>
              <select
                defaultValue={project.membership?.role ?? "none"}
                disabled={pending}
                onChange={(e) => handleRoleChange(project.id, e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors disabled:opacity-50"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

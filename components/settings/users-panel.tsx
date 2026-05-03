"use client";

import { inviteUser, revokeInvite, setUserActive } from "@/lib/users/actions";
import { FolderOpenIcon, MailIcon, PlusIcon, ShieldOffIcon, Trash2Icon, UserCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type User = {
  id: string;
  name: string | null;
  email: string;
  isOwner: boolean;
  isActive: boolean;
  createdAt: Date;
};

type PendingInvite = {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  project: { name: string; slug: string } | null;
  invitedBy: { name: string | null; email: string | null } | null;
};

interface Props {
  users: User[];
  pendingInvites: PendingInvite[];
}

const ROLES = ["owner", "admin", "sales", "viewer"] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  sales: "Vendas",
  viewer: "Visualizador",
};

export function UsersPanel({ users: initialUsers, pendingInvites: initialInvites }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [invites, setInvites] = useState(initialInvites);
  const [, startTransition] = useTransition();

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("sales");
  const [showInviteForm, setShowInviteForm] = useState(false);

  function handleToggleActive(userId: string, currentActive: boolean) {
    startTransition(async () => {
      try {
        await setUserActive({ userId, isActive: !currentActive });
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, isActive: !currentActive } : u)),
        );
        toast.success(currentActive ? "Usuário desativado." : "Usuário reativado.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao atualizar usuário");
      }
    });
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    startTransition(async () => {
      try {
        const result = await inviteUser({ email: inviteEmail.trim(), role: inviteRole });
        if (result.status === "already_user") {
          toast.success("Usuário já existe no sistema.");
        } else {
          toast.success("Convite enviado com sucesso.");
          // Optimistically add to pending invites
          if (result.invite) {
            setInvites((prev) => [
              {
                ...result.invite,
                invitedBy: { name: null, email: null },
                project: null,
              } as PendingInvite,
              ...prev,
            ]);
          }
        }
        setInviteEmail("");
        setShowInviteForm(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao convidar");
      }
    });
  }

  function handleRevokeInvite(inviteId: string) {
    startTransition(async () => {
      try {
        await revokeInvite({ inviteId });
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
        toast.success("Convite revogado.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao revogar convite");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Active users */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-300">Usuários</h2>
          {!showInviteForm && (
            <button
              type="button"
              onClick={() => setShowInviteForm(true)}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Convidar
            </button>
          )}
        </div>

        {/* Invite form */}
        {showInviteForm && (
          <form
            onSubmit={handleInvite}
            className="mb-4 rounded-lg border border-dashed border-zinc-700 bg-zinc-900 p-4 space-y-3"
          >
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Convidar usuário
            </h3>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@exemplo.com"
                required
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
              >
                <MailIcon className="h-3.5 w-3.5" />
                Enviar convite
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteEmail("");
                }}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* User list */}
        <div className="space-y-1.5">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5"
            >
              {/* Avatar */}
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-bold text-indigo-400">
                {user.name?.[0]?.toUpperCase() ?? user.email[0]?.toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">
                  {user.name ?? user.email}
                </p>
                {user.name && (
                  <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                )}
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {user.isOwner && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 uppercase tracking-wider">
                    Owner
                  </span>
                )}
                {!user.isActive && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 uppercase tracking-wider">
                    Inativo
                  </span>
                )}
              </div>

              {/* Manage project access */}
              {!user.isOwner && (
                <Link
                  href={`/settings/users/${user.id}`}
                  title="Gerenciar projetos"
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-indigo-400 transition-colors"
                >
                  <FolderOpenIcon className="h-3.5 w-3.5" />
                </Link>
              )}

              {/* Toggle active (can't deactivate owners) */}
              {!user.isOwner && (
                <button
                  type="button"
                  onClick={() => handleToggleActive(user.id, user.isActive)}
                  title={user.isActive ? "Desativar acesso" : "Reativar acesso"}
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors ${
                    user.isActive
                      ? "text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                      : "text-zinc-600 hover:bg-zinc-800 hover:text-green-400"
                  }`}
                >
                  {user.isActive ? (
                    <ShieldOffIcon className="h-3.5 w-3.5" />
                  ) : (
                    <UserCheckIcon className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Convites pendentes</h2>
          <div className="space-y-1.5">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5"
              >
                <MailIcon className="h-4 w-4 flex-shrink-0 text-zinc-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{invite.email}</p>
                  <p className="text-xs text-zinc-600">
                    {invite.project ? (
                      <>
                        Projeto: <span className="text-zinc-500">{invite.project.name}</span>
                        {" · "}
                      </>
                    ) : null}
                    Papel: <span className="text-zinc-500">{ROLE_LABELS[invite.role as Role] ?? invite.role}</span>
                    {" · "}
                    Expira:{" "}
                    <span className="text-zinc-500">
                      {new Date(invite.expiresAt).toLocaleDateString("pt-BR")}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeInvite(invite.id)}
                  title="Revogar convite"
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

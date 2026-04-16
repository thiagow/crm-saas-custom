"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import type { User } from "next-auth";
import { cn } from "@/lib/utils";
import type { projects } from "@/db/schema";

type Project = typeof projects.$inferSelect;

interface AppShellProps {
  children: ReactNode;
  projects: Project[];
  user: User & { isOwner?: boolean };
}

export function AppShell({ children, projects, user }: AppShellProps) {
  const params = useParams();
  const pathname = usePathname();
  const currentProjectSlug = params["project"] as string | undefined;
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-zinc-800 bg-zinc-950 transition-all duration-200",
          sidebarOpen ? "w-56" : "w-14",
        )}
      >
        {/* Top: Logo + Toggle */}
        <div className="flex h-12 items-center justify-between px-3 border-b border-zinc-800">
          {sidebarOpen && (
            <span className="text-sm font-semibold text-zinc-100 tracking-tight">CRM</span>
          )}
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>

        {/* Projects list */}
        <div className="flex-1 overflow-y-auto py-2">
          {sidebarOpen && (
            <div className="px-3 mb-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Projetos
              </span>
            </div>
          )}
          <nav className="space-y-0.5 px-2">
            {projects.map((project) => {
              const isActive = currentProjectSlug === project.slug;
              return (
                <Link
                  key={project.id}
                  href={`/${project.slug}/kanban`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                  )}
                  title={!sidebarOpen ? project.name : undefined}
                >
                  <div
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold"
                    style={{ backgroundColor: `${project.type === "B2B" ? "#6366f1" : "#8b5cf6"}20`, color: project.type === "B2B" ? "#818cf8" : "#a78bfa" }}
                  >
                    {project.name[0]?.toUpperCase()}
                  </div>
                  {sidebarOpen && (
                    <span className="truncate">{project.name}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom: settings + new project + user */}
        <div className="border-t border-zinc-800 p-2 space-y-0.5">
          <Link
            href="/projects/new"
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition-colors",
              !sidebarOpen && "justify-center",
            )}
            title={!sidebarOpen ? "Novo projeto" : undefined}
          >
            <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            {sidebarOpen && <span>Novo projeto</span>}
          </Link>

          {/* Users (owner only) */}
          {user.isOwner && (
            <Link
              href="/settings/users"
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                pathname.startsWith("/settings/users")
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
                !sidebarOpen && "justify-center",
              )}
              title={!sidebarOpen ? "Usuários" : undefined}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {sidebarOpen && <span>Usuários</span>}
            </Link>
          )}

          {/* Security */}
          <Link
            href="/settings/security"
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
              pathname.startsWith("/settings/security")
                ? "bg-zinc-800 text-zinc-200"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
              !sidebarOpen && "justify-center",
            )}
            title={!sidebarOpen ? "Segurança" : undefined}
          >
            <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            {sidebarOpen && <span>Segurança</span>}
          </Link>

          {/* User identity */}
          {sidebarOpen && (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <div className="h-6 w-6 flex-shrink-0 rounded-full bg-indigo-500/20 flex items-center justify-center text-[10px] font-bold text-indigo-400">
                {user.name?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase() ?? "U"}
              </div>
              <span className="truncate text-xs text-zinc-500">{user.email}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Per-project top nav */}
        {currentProjectSlug && (
          <ProjectNav slug={currentProjectSlug} pathname={pathname} />
        )}
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}

function ProjectNav({ slug, pathname }: { slug: string; pathname: string }) {
  const navItems = [
    { label: "Kanban", href: `/${slug}/kanban` },
    { label: "Leads", href: `/${slug}/leads` },
    { label: "Extrações", href: `/${slug}/extractions` },
    { label: "Triagem", href: `/${slug}/triage` },
    { label: "Configurações", href: `/${slug}/settings` },
  ];

  return (
    <div className="flex items-center gap-1 border-b border-zinc-800 px-4 h-11">
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              isActive
                ? "text-zinc-100 bg-zinc-800"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

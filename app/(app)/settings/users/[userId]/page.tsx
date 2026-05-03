import { UserProjectsPanel } from "@/components/settings/user-projects-panel";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { projectMembers, projects, users } from "@/db/schema";
import { eq, isNull } from "drizzle-orm";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Acesso a projetos" };

export default async function UserProjectsPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { isOwner: true },
  });
  if (!currentUser?.isOwner) redirect("/");

  const { userId } = await params;

  const [targetUser, allProjects, memberships] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, name: true, email: true },
    }),
    db.query.projects.findMany({
      where: isNull(projects.archivedAt),
      columns: { id: true, name: true, slug: true, type: true },
      orderBy: (p, { asc }) => [asc(p.name)],
      limit: 500,
    }),
    db.query.projectMembers.findMany({
      where: eq(projectMembers.userId, userId),
      columns: { id: true, projectId: true, role: true },
      limit: 1000,
    }),
  ]);

  if (!targetUser) redirect("/settings/users");

  const membershipMap = new Map(memberships.map((m) => [m.projectId, m]));
  const projectsWithMembership = allProjects.map((p) => ({
    ...p,
    membership: membershipMap.get(p.id) ?? null,
  }));

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link
          href="/settings/users"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          Usuários
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">
          {targetUser.name ?? targetUser.email}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">{targetUser.email}</p>
      </div>

      <UserProjectsPanel userId={userId} projects={projectsWithMembership} />
    </div>
  );
}

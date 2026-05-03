import { UsersPanel } from "@/components/settings/users-panel";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { invites, projects, users } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

export const metadata = { title: "Usuários — Gestão de acesso" };

export default async function UsersSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Only owners can access this page
  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { isOwner: true },
  });
  if (!currentUser?.isOwner) redirect("/");

  const now = new Date();

  const [allUsers, pendingInvites, allProjects] = await Promise.all([
    db.query.users.findMany({
      columns: { id: true, name: true, email: true, isOwner: true, isActive: true, createdAt: true },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 500,
    }),
    db.query.invites.findMany({
      where: and(isNull(invites.acceptedAt), gt(invites.expiresAt, now)),
      with: {
        invitedBy: { columns: { name: true, email: true } },
        project: { columns: { name: true, slug: true } },
      },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 200,
    }),
    db.query.projects.findMany({
      where: isNull(projects.archivedAt),
      columns: { id: true, name: true, slug: true },
      orderBy: (p, { asc }) => [asc(p.name)],
      limit: 500,
    }),
  ]);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-zinc-100">Usuários</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Gerencie quem tem acesso ao sistema. Convide pelo email — o usuário receberá um link de
          acesso.
        </p>
      </div>

      <UsersPanel users={allUsers} pendingInvites={pendingInvites} projects={allProjects} />
    </div>
  );
}

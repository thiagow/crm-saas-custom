import { UsersPanel } from "@/components/settings/users-panel";
import { auth } from "@/lib/auth";
import { getPendingInvites, getUsers } from "@/lib/users/actions";
import { getProjects } from "@/lib/projects/actions";
import { db } from "@/lib/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
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

  const [allUsers, pendingInvites, allProjects] = await Promise.all([
    getUsers(),
    getPendingInvites(),
    getProjects(),
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

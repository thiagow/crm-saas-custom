import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { and, eq, notInArray } from "drizzle-orm";
import { projects, pipelineStages, projectMembers, users } from "@/db/schema";
import { requireRole } from "@/lib/auth/rbac";
import { SettingsForm } from "@/components/settings/settings-form";

interface Props {
  params: Promise<{ project: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { project } = await params;
  return { title: `Configurações — ${project}` };
}

export default async function SettingsPage({ params }: Props) {
  const { project: projectSlug } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
  });
  if (!project) notFound();

  try {
    await requireRole(session.user.id, project.id, "admin");
  } catch {
    redirect(`/${projectSlug}/kanban`);
  }

  const stages = await db.query.pipelineStages.findMany({
    where: eq(pipelineStages.projectId, project.id),
    orderBy: (t, { asc }) => [asc(t.order)],
  });

  const members = await db.query.projectMembers.findMany({
    where: eq(projectMembers.projectId, project.id),
    with: { user: { columns: { id: true, name: true, email: true } } },
  });

  // Users who are active but not already members — available to add
  const existingMemberUserIds = members.map((m) => m.user.id);
  const availableUsers =
    existingMemberUserIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(
            and(
              eq(users.isActive, true),
              notInArray(users.id, existingMemberUserIds),
            ),
          )
          .orderBy(users.email)
      : await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.isActive, true))
          .orderBy(users.email);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-zinc-100">Configurações do projeto</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Gerencie as configurações, estágios do funil e membros do projeto.
        </p>
      </div>

      <SettingsForm
        project={project}
        stages={stages}
        members={members}
        availableUsers={availableUsers}
      />
    </div>
  );
}

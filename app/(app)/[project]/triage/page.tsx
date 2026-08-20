import { TriageTable } from "@/components/extractions/triage-table";
import { pipelineStages, projects } from "@/db/schema";
import { auth, getIsOwner } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { forProject } from "@/lib/db/for-project";
import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

interface Props {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ extractionId?: string }>;
}

export const metadata = { title: "Triagem" };

export default async function TriagePage({ params, searchParams }: Props) {
  const { project: projectSlug } = await params;
  const { extractionId } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.slug, projectSlug), isNull(projects.archivedAt)),
    columns: { id: true },
  });
  if (!project) notFound();

  // Membership check — without this, any authenticated user who guesses a slug
  // could see another project's pipeline stage names/colors below.
  await forProject(project.id, session.user.id, getIsOwner(session));

  const stages = await db.query.pipelineStages.findMany({
    where: eq(pipelineStages.projectId, project.id),
    orderBy: [asc(pipelineStages.order)],
    columns: { id: true, name: true, color: true },
  });

  const firstStage = stages[0];
  if (!firstStage) {
    return (
      <div className="p-6">
        <p className="text-sm text-zinc-500">Configure os estágios do pipeline antes de triagem.</p>
      </div>
    );
  }

  return (
    <TriageTable
      projectSlug={projectSlug}
      stages={stages}
      defaultStageId={firstStage.id}
      initialExtractionId={extractionId}
    />
  );
}

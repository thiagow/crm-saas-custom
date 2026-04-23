import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { leads, pipelineStages, projects } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { LeadsTable } from "@/components/leads/leads-table";

interface Props {
  params: Promise<{ project: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { project } = await params;
  return { title: `Leads — ${project}` };
}

export default async function LeadsPage({ params }: Props) {
  const { project: projectSlug } = await params;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.slug, projectSlug), isNull(projects.archivedAt)),
    columns: { id: true },
  });
  if (!project) notFound();

  const [allLeads, stages] = await Promise.all([
    db.query.leads.findMany({
      where: eq(leads.projectId, project.id),
      with: { stage: true },
      orderBy: [asc(leads.createdAt)],
      limit: 500,
    }),
    db.query.pipelineStages.findMany({
      where: eq(pipelineStages.projectId, project.id),
      orderBy: [asc(pipelineStages.order)],
    }),
  ]);

  return (
    <LeadsTable leads={allLeads} stages={stages} projectSlug={projectSlug} />
  );
}

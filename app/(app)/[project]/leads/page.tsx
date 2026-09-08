import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { leads, pipelineStages, projects } from "@/db/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { LeadsTable } from "@/components/leads/leads-table";
import { getExtractionOptions } from "@/lib/extractions/actions";

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

  const [allLeads, stages, extractionOptions] = await Promise.all([
    db.query.leads.findMany({
      where: eq(leads.projectId, project.id),
      with: { stage: true },
      orderBy: [desc(leads.createdAt)],
      limit: 500,
    }),
    db.query.pipelineStages.findMany({
      where: eq(pipelineStages.projectId, project.id),
      orderBy: [asc(pipelineStages.order)],
    }),
    getExtractionOptions(projectSlug),
  ]);

  return (
    <LeadsTable
      initialLeads={allLeads}
      stages={stages}
      projectSlug={projectSlug}
      extractionOptions={extractionOptions}
    />
  );
}

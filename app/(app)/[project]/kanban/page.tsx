import { notFound } from "next/navigation";
import { getKanbanData } from "@/lib/leads/actions";
import { KanbanBoard } from "@/components/kanban/kanban-board";

interface Props {
  params: Promise<{ project: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { project } = await params;
  return { title: `Kanban — ${project}` };
}

export default async function KanbanPage({ params }: Props) {
  const { project: projectSlug } = await params;

  let data: Awaited<ReturnType<typeof getKanbanData>>;
  try {
    data = await getKanbanData(projectSlug);
  } catch (err) {
    if (err instanceof Error && err.message === "Project not found") notFound();
    throw err;
  }

  return <KanbanBoard initialData={data} projectSlug={projectSlug} />;
}

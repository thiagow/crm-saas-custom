import { redirect } from "next/navigation";
import { getProjects } from "@/lib/projects/actions";

/**
 * Root app route — redirect to the first project's kanban,
 * or to project creation if no projects exist.
 */
export default async function AppRootPage() {
  const projects = await getProjects();

  if (projects.length === 0) {
    redirect("/projects/new");
  }

  const firstProject = projects[0];
  if (!firstProject) redirect("/projects/new");

  redirect(`/${firstProject.slug}/kanban`);
}

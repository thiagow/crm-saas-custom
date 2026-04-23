import { redirect } from "next/navigation";
import { getProjects } from "@/lib/projects/actions";

export default async function AppRootPage() {
  let projects;
  try {
    projects = await getProjects();
  } catch {
    redirect("/login");
  }

  if (!projects || projects.length === 0) {
    redirect("/projects/new");
  }

  const firstProject = projects[0];
  if (!firstProject) redirect("/projects/new");

  redirect(`/${firstProject.slug}/kanban`);
}

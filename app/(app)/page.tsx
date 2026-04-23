import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjects } from "@/lib/projects/actions";

export default async function AppRootPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const projects = await getProjects(session.user.id);

  if (!projects.length) {
    redirect("/projects/new");
  }

  redirect(`/${projects[0]!.slug}/kanban`);
}

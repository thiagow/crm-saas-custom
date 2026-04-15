import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjects } from "@/lib/projects/actions";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const projects = await getProjects();

  return <AppShell projects={projects} user={session.user}>{children}</AppShell>;
}

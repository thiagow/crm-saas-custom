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

  const projects = await getProjects(session.user.id);

  // isOwner is set in the session callback from the JWT token
  const user = session.user as typeof session.user & { isOwner?: boolean };

  return <AppShell projects={projects} user={user}>{children}</AppShell>;
}

import { SecuritySessionList } from "@/components/settings/security-session-list";
import { auth } from "@/lib/auth";
import { getActiveSessions } from "@/lib/auth/session-actions";
import { redirect } from "next/navigation";

export const metadata = { title: "Segurança — Sessões ativas" };

export default async function SecurityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const activeSessions = await getActiveSessions();

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-zinc-100">Segurança</h1>
        <p className="text-sm text-zinc-500 mt-1">Gerencie as sessões ativas da sua conta.</p>
      </div>

      <SecuritySessionList sessions={activeSessions} />
    </div>
  );
}

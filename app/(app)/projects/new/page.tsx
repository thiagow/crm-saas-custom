import { redirect } from "next/navigation";
import { createProject } from "@/lib/projects/actions";
import { auth } from "@/lib/auth";

export const metadata = { title: "Novo Projeto" };

export default async function NewProjectPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">Novo projeto</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cada projeto é um workspace isolado com seu próprio pipeline de vendas.
          </p>
        </div>

        <form
          className="space-y-4"
          action={async (formData: FormData) => {
            "use server";
            const session = await auth();
            if (!session?.user?.id) throw new Error("Unauthorized");

            const name = formData.get("name") as string;
            const type = formData.get("type") as "B2B" | "B2C";
            const description = formData.get("description") as string;

            // Auto-generate slug from name
            const slug = name
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 50);

            const project = await createProject({ name, slug, type, description });
            redirect(`/${project.slug}/kanban`);
          }}
        >
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-zinc-400 mb-1.5">
              Nome do projeto
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoFocus
              maxLength={80}
              placeholder="Ex: Academias de Luta"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">
              Modelo de negócio
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["B2B", "B2C"] as const).map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 hover:border-zinc-700 transition-colors has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-500/5"
                >
                  <input
                    type="radio"
                    name="type"
                    value={type}
                    defaultChecked={type === "B2B"}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-zinc-200">{type}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {type === "B2B"
                        ? "Empresas como clientes"
                        : "Consumidores finais"}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-zinc-400 mb-1.5">
              Descrição <span className="text-zinc-600">(opcional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              maxLength={300}
              placeholder="Ex: Prospecção de academias de MMA e Muay Thai em SP"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] transition-colors"
          >
            Criar projeto
          </button>
        </form>
      </div>
    </div>
  );
}

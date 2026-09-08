/**
 * CSV export of selected leads — components/leads/leads-table.tsx "Exportar CSV" button.
 *
 * A Route Handler rather than a Server Action: only a Route Handler can set
 * `Content-Disposition` so the browser saves a real file with a real name — a Server
 * Action's return value has no way to trigger that (see lib/leads/actions.ts for the
 * normal server-action pattern used everywhere else in this codebase).
 */
import { leads, projects } from "@/db/schema";
import { auth, getIsOwner } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { forProject } from "@/lib/db/for-project";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import Papa from "papaparse";
import { z } from "zod";

const exportSchema = z.object({
  projectSlug: z.string(),
  leadIds: z.array(z.string()).min(1).max(2000),
});

const SOURCE_LABELS: Record<string, string> = {
  google_maps: "Maps",
  csv_import: "CSV",
  manual: "Manual",
};

const GBP_LABELS: Record<string, string> = {
  claimed: "Reivindicado",
  unclaimed: "Não reivindicado",
  unknown: "Desconhecido",
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = exportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const data = parsed.data;

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Read-only export — same check as getTriageResults/getLeadsFiltered, not requireRole.
  await forProject(project.id, session.user.id, getIsOwner(session));

  // eq(leads.projectId, project.id) here is what stops a caller from exporting another
  // tenant's leads by guessing ids — the id list alone is never trusted.
  const rows = await db.query.leads.findMany({
    where: and(eq(leads.projectId, project.id), inArray(leads.id, data.leadIds)),
    with: { stage: true },
  });

  const csvRows = rows.map((lead) => ({
    Nome: lead.name,
    Empresa: lead.company ?? "",
    Telefone: lead.phone ?? "",
    WhatsApp: lead.whatsapp ?? "",
    Email: lead.email ?? "",
    Site: lead.website ?? "",
    Instagram: lead.instagramHandle ? `@${lead.instagramHandle}` : "",
    Cidade: lead.city ?? "",
    UF: lead.state ?? "",
    Endereço: lead.address ?? "",
    Categoria: lead.category ?? "",
    Avaliação: lead.rating ?? "",
    "Nº avaliações": lead.reviewsCount ?? "",
    GMN: GBP_LABELS[lead.gbpStatus] ?? lead.gbpStatus,
    "Dono/Responsável": lead.ownerName ?? "",
    "E-mail do dono": lead.ownerEmail ?? "",
    CNPJ: lead.cnpj ?? "",
    Etapa: lead.stage.name,
    Origem: SOURCE_LABELS[lead.source] ?? lead.source,
    "Criado em": lead.createdAt.toISOString().slice(0, 10),
  }));

  // ﻿ (UTF-8 BOM) so Excel on Windows doesn't mangle acentuação — a plain UTF-8 CSV
  // opens with "Cl?nica" instead of "Clínica" otherwise. Sheets/Numbers ignore the BOM.
  const csv = `﻿${Papa.unparse(csvRows)}`;
  const filename = `leads-${data.projectSlug}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

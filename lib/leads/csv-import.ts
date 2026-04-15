"use server";

import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/rbac";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const rowSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  city: z.string().optional(),
  state: z.string().optional(),
  instagram: z.string().optional(),
});

export interface CsvImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importLeadsFromCsv(input: {
  projectSlug: string;
  stageId: string;
  rows: Array<Record<string, string>>;
  columnMap: {
    name: string;
    company?: string;
    phone?: string;
    email?: string;
    website?: string;
    city?: string;
    state?: string;
    instagram?: string;
  };
}): Promise<CsvImportResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, input.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales");

  const { rows, columnMap, stageId } = input;
  const errors: string[] = [];
  const validRows: z.infer<typeof rowSchema>[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const mapped = {
      name: columnMap.name ? (row[columnMap.name] ?? "") : "",
      company: columnMap.company ? row[columnMap.company] : undefined,
      phone: columnMap.phone ? row[columnMap.phone] : undefined,
      email: columnMap.email ? row[columnMap.email] : undefined,
      website: columnMap.website ? row[columnMap.website] : undefined,
      city: columnMap.city ? row[columnMap.city] : undefined,
      state: columnMap.state ? row[columnMap.state] : undefined,
      instagram: columnMap.instagram ? row[columnMap.instagram] : undefined,
    };

    const parsed = rowSchema.safeParse(mapped);
    if (!parsed.success) {
      errors.push(`Linha ${i + 2}: ${parsed.error.issues[0]?.message ?? "Inválida"}`);
      continue;
    }
    validRows.push(parsed.data);
  }

  if (validRows.length === 0) {
    return { imported: 0, skipped: rows.length, errors };
  }

  // Batch insert
  const BATCH_SIZE = 50;
  let imported = 0;
  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE);
    const inserted = await db
      .insert(leads)
      .values(
        batch.map((row) => ({
          projectId: project.id,
          stageId,
          name: row.name,
          company: row.company ?? row.name,
          phone: row.phone ?? null,
          email: row.email || null,
          website: row.website || null,
          instagramHandle: row.instagram?.replace(/^@/, "").toLowerCase() ?? null,
          city: row.city ?? null,
          state: row.state ?? null,
          source: "csv_import" as const,
          tags: [],
          customFields: {},
        })),
      )
      .returning({ id: leads.id });
    imported += inserted.length;
  }

  revalidatePath(`/${input.projectSlug}/kanban`);
  revalidatePath(`/${input.projectSlug}/leads`);

  return { imported, skipped: rows.length - validRows.length, errors };
}

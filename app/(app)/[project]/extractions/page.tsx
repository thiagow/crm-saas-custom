import { notFound } from "next/navigation";
import { getExtractions } from "@/lib/extractions/actions";
import { ExtractionsList } from "@/components/extractions/extractions-list";
import { NewExtractionButton } from "@/components/extractions/new-extraction-button";

interface Props {
  params: Promise<{ project: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { project } = await params;
  return { title: `Extrações — ${project}` };
}

export default async function ExtractionsPage({ params }: Props) {
  const { project: projectSlug } = await params;

  let extractionList: Awaited<ReturnType<typeof getExtractions>>;
  try {
    extractionList = await getExtractions(projectSlug);
  } catch (err) {
    if (err instanceof Error && err.message === "Project not found") notFound();
    throw err;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Extrações</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Descubra empresas via Google Maps por segmento e localização.
          </p>
        </div>
        <NewExtractionButton projectSlug={projectSlug} />
      </div>
      <ExtractionsList extractions={extractionList} projectSlug={projectSlug} />
    </div>
  );
}

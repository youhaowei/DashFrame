/**
 * SPIKE: the insight pane owns metric writes and the chart pane owns encoding
 * writes, and they are siblings. A shelf metric dropped on the Y well needs
 * both, so the insight pane registers its import here by insight id. A real
 * implementation lifts both write paths into one owner instead.
 */
type MeasureImporter = (savedMetricId: string) => Promise<string>;

const importers = new Map<string, MeasureImporter>();

export function registerShelfMeasureImporter(
  insightId: string,
  importer: MeasureImporter,
): () => void {
  importers.set(insightId, importer);
  return () => {
    if (importers.get(insightId) === importer) importers.delete(insightId);
  };
}

export function getShelfMeasureImporter(
  insightId: string,
): MeasureImporter | undefined {
  return importers.get(insightId);
}

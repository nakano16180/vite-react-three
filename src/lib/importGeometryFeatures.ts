import type { GeometryRepository } from "../db/geometryRepository";
import { importFeatureCollection, type ImportedGeoJSON } from "./geojson";

type ImportRepository = Pick<GeometryRepository, "listFeatures" | "importGeoJSON">;

export const importGeometryFeatures = async (
  repository: ImportRepository,
  readText: () => Promise<string>
): Promise<ImportedGeoJSON> => {
  const contents = await readText();
  const existingFeatures = await repository.listFeatures();
  const imported = importFeatureCollection(JSON.parse(contents), new Set(existingFeatures.map(({ id }) => id)));
  await repository.importGeoJSON(imported.layers, imported.features);
  return imported;
};

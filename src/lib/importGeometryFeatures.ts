import { PersistenceCheckpointError, type GeometryRepository } from "../db/geometryRepository";
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

export const importGeometryFeaturesWithContext = async (
  repository: ImportRepository,
  readText: () => Promise<string>
): Promise<ImportedGeoJSON> => {
  try {
    return await importGeometryFeatures(repository, readText);
  } catch (error) {
    if (error instanceof PersistenceCheckpointError) throw error;
    throw new Error(`GeoJSON import failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
};

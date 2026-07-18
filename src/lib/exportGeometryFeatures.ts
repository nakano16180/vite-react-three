import type { GeometryRepository } from "../db/geometryRepository";
import { exportFeatureCollection } from "./geojson";

type ExportRepository = Pick<GeometryRepository, "listFeatures" | "listLayers">;

export const loadExportFeatureCollection = async (repository: ExportRepository) => {
  const [features, layers] = await Promise.all([repository.listFeatures(), repository.listLayers()]);
  return exportFeatureCollection(features, layers);
};

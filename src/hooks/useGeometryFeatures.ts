import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createDuckDB, type DuckDBContext, type FeatureStore } from "../db/createDuckDB";
import { GeometryRepository } from "../db/geometryRepository";
import {
  DEFAULT_LAYER_ID,
  createGeometryFeature,
  type FeatureGeometry,
  type GeometryFeature,
  type Layer,
  type Point2D,
} from "../domain/geometryFeature";
import { simplifyFeatureGeometry, toRenderableStroke } from "../domain/renderableStroke";
import { exportFeatureCollection, importFeatureCollection } from "../lib/geojson";

export type GeometryType = "line" | "polygon";

export interface StorageStatus {
  opfs: boolean;
  spatial: boolean;
  store: FeatureStore;
  migrationWarning?: string;
  error?: string;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function useGeometryFeatures(strokeColor: string, strokeWidth: number, simplifyOn: boolean) {
  const repositoryRef = useRef<GeometryRepository | null>(null);
  const [features, setFeatures] = useState<GeometryFeature[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({
    opfs: false,
    spatial: false,
    store: "json",
  });

  const loadRepositoryState = useCallback(async (repository: GeometryRepository) => {
    const [nextFeatures, nextLayers] = await Promise.all([repository.listFeatures(), repository.listLayers()]);
    setFeatures(nextFeatures);
    setLayers(nextLayers);
    setStorageStatus((current) => ({ ...current, error: undefined }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ownedContext: DuckDBContext | null = null;

    void (async () => {
      setLoading(true);
      try {
        const context = await createDuckDB();
        ownedContext = context;
        if (cancelled) return;

        const repository = new GeometryRepository(context.connection, context.capabilities);
        const { migrationWarning } = await repository.initialize();
        if (cancelled) return;

        repositoryRef.current = repository;
        setStorageStatus({ ...context.capabilities, migrationWarning });
        await loadRepositoryState(repository);
      } catch (error) {
        if (!cancelled) {
          setStorageStatus((current) => ({ ...current, error: errorMessage(error) }));
        }
      } finally {
        if (!cancelled) setLoading(false);
        if (cancelled && ownedContext) {
          await ownedContext.connection.close().catch(() => undefined);
          await ownedContext.db.terminate().catch(() => undefined);
          ownedContext = null;
        }
      }
    })();

    return () => {
      cancelled = true;
      repositoryRef.current = null;
      if (ownedContext) {
        const context = ownedContext;
        ownedContext = null;
        void context.connection
          .close()
          .catch(() => undefined)
          .finally(() => context.db.terminate().catch(() => undefined));
      }
    };
  }, [loadRepositoryState]);

  const runRepositoryAction = useCallback(
    async (action: (repository: GeometryRepository) => Promise<void>) => {
      const repository = repositoryRef.current;
      if (!repository) return;
      try {
        await action(repository);
        await loadRepositoryState(repository);
      } catch (error) {
        setStorageStatus((current) => ({ ...current, error: errorMessage(error) }));
      }
    },
    [loadRepositoryState]
  );

  const handleRefresh = useCallback(async () => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try {
      await loadRepositoryState(repository);
    } catch (error) {
      setStorageStatus((current) => ({ ...current, error: errorMessage(error) }));
    }
  }, [loadRepositoryState]);

  const handleUndo = useCallback(
    () => runRepositoryAction((repository) => repository.deleteLatestFeature()),
    [runRepositoryAction]
  );
  const handleClear = useCallback(
    () => runRepositoryAction((repository) => repository.clearFeatures()),
    [runRepositoryAction]
  );

  const persistStroke = useCallback(
    async (points: Point2D[], geomType: GeometryType) => {
      if (points.length < (geomType === "polygon" ? 3 : 2)) return;
      const geometry: FeatureGeometry = {
        type: geomType === "polygon" ? "Polygon" : "LineString",
        coordinates: points,
      };
      const canonicalGeometry = simplifyOn
        ? simplifyFeatureGeometry(geometry, Math.max(0, Math.min(strokeWidth * 0.3, 3)))
        : simplifyFeatureGeometry(geometry, 0);
      const feature = createGeometryFeature({
        geometry: canonicalGeometry,
        style: { strokeColor, strokeWidth },
        layerId: DEFAULT_LAYER_ID,
      });
      await runRepositoryAction((repository) => repository.insertFeature(feature));
    },
    [runRepositoryAction, simplifyOn, strokeColor, strokeWidth]
  );

  const updateStroke = useCallback(
    async (id: string, points: Point2D[]) => {
      const feature = features.find((candidate) => candidate.id === id);
      if (!feature || points.length < (feature.geometry.type === "Polygon" ? 3 : 2)) return;
      const geometry = { type: feature.geometry.type, coordinates: points } as FeatureGeometry;
      await runRepositoryAction((repository) => repository.updateGeometry(id, geometry));
    },
    [features, runRepositoryAction]
  );

  const handleImportGeoJSON = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const imported = importFeatureCollection(JSON.parse(await file.text()), new Set(features.map(({ id }) => id)));
        await runRepositoryAction(async (repository) => {
          await repository.insertLayers(imported.layers);
          for (const feature of imported.features) await repository.insertFeature(feature);
        });
        if (imported.warnings.length > 0) {
          setStorageStatus((current) => ({
            ...current,
            migrationWarning: `GeoJSON import: ${imported.warnings.length}件をスキップしました。`,
          }));
        }
      } catch (error) {
        setStorageStatus((current) => ({ ...current, error: `GeoJSON import failed: ${errorMessage(error)}` }));
      }
    },
    [features, runRepositoryAction]
  );

  const handleExportGeoJSON = useCallback(async () => {
    try {
      const blob = new Blob([JSON.stringify(exportFeatureCollection(features, layers), null, 2)], {
        type: "application/geo+json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `strokes-${new Date().toISOString().slice(0, 10)}.geojson`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setStorageStatus((current) => ({ ...current, error: `GeoJSON export failed: ${errorMessage(error)}` }));
    }
  }, [features, layers]);

  const strokes = useMemo(() => features.map(toRenderableStroke), [features]);

  return {
    features,
    layers,
    loading,
    storageStatus,
    strokes,
    persistStroke,
    updateStroke,
    handleUndo,
    handleClear,
    handleRefresh,
    handleImportGeoJSON,
    handleExportGeoJSON,
  };
}

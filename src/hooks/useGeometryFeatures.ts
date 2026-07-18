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
import { exportFeatureCollection } from "../lib/geojson";
import { importGeometryFeatures } from "../lib/importGeometryFeatures";
import { createPromiseQueue } from "../lib/promiseQueue";

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
  const generationRef = useRef(0);
  const queueRef = useRef(createPromiseQueue());
  const [features, setFeatures] = useState<GeometryFeature[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [loading, setLoading] = useState(true);
  const [operationNotice, setOperationNotice] = useState<string>();
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({
    opfs: false,
    spatial: false,
    store: "json",
  });

  const loadRepositoryState = useCallback(async (repository: GeometryRepository, generation: number) => {
    const [nextFeatures, nextLayers] = await Promise.all([repository.listFeatures(), repository.listLayers()]);
    if (generationRef.current !== generation || repositoryRef.current !== repository) return false;
    setFeatures(nextFeatures);
    setLayers(nextLayers);
    setStorageStatus((current) => ({ ...current, error: undefined }));
    return true;
  }, []);

  useEffect(() => {
    const enqueue = queueRef.current;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let ownedContext: DuckDBContext | null = null;
    let cleanupPromise: Promise<void> | null = null;
    const isCurrent = () => generationRef.current === generation;
    const cleanupContext = () => {
      if (cleanupPromise) return cleanupPromise;
      const context = ownedContext;
      ownedContext = null;
      cleanupPromise = context
        ? context.connection
            .close()
            .catch(() => undefined)
            .then(() => context.db.terminate().catch(() => undefined))
        : Promise.resolve();
      return cleanupPromise;
    };

    setLoading(true);
    void enqueue(async () => {
      try {
        const context = await createDuckDB();
        ownedContext = context;
        if (!isCurrent()) return;

        const repository = new GeometryRepository(context.connection, context.capabilities);
        const { migrationWarning } = await repository.initialize();
        if (!isCurrent()) return;

        repositoryRef.current = repository;
        setStorageStatus({ ...context.capabilities, migrationWarning });
        await loadRepositoryState(repository, generation);
      } catch (error) {
        if (isCurrent()) {
          setStorageStatus((current) => ({ ...current, error: errorMessage(error) }));
        }
      } finally {
        if (isCurrent()) setLoading(false);
        else await cleanupContext();
      }
    });

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      repositoryRef.current = null;
      void enqueue(cleanupContext);
    };
  }, [loadRepositoryState]);

  const runRepositoryAction = useCallback(
    (action: (repository: GeometryRepository) => Promise<void>, onSuccess?: () => void) =>
      queueRef.current(async () => {
        const repository = repositoryRef.current;
        const generation = generationRef.current;
        if (!repository) return false;
        setOperationNotice(undefined);
        try {
          await action(repository);
          const loaded = await loadRepositoryState(repository, generation);
          if (loaded) onSuccess?.();
          return loaded;
        } catch (error) {
          if (generationRef.current === generation && repositoryRef.current === repository) {
            setStorageStatus((current) => ({ ...current, error: errorMessage(error) }));
          }
          return false;
        }
      }),
    [loadRepositoryState]
  );

  const handleRefresh = useCallback(
    () => runRepositoryAction(async () => undefined).then(() => undefined),
    [runRepositoryAction]
  );

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
      let warnings: string[] = [];
      await runRepositoryAction(
        async (repository) => {
          try {
            const imported = await importGeometryFeatures(repository, () => file.text());
            warnings = imported.warnings;
          } catch (error) {
            throw new Error(`GeoJSON import failed: ${errorMessage(error)}`);
          }
        },
        () => {
          if (warnings.length > 0) {
            setOperationNotice(`GeoJSON import: ${warnings.length}件をスキップしました。`);
          }
        }
      );
    },
    [runRepositoryAction]
  );

  const handleExportGeoJSON = useCallback(async () => {
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    setOperationNotice(undefined);
    try {
      const blob = new Blob([JSON.stringify(exportFeatureCollection(features, layers), null, 2)], {
        type: "application/geo+json",
      });
      url = URL.createObjectURL(blob);
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `strokes-${new Date().toISOString().slice(0, 10)}.geojson`;
      document.body.appendChild(anchor);
      anchor.click();
    } catch (error) {
      if (repositoryRef.current) {
        setStorageStatus((current) => ({ ...current, error: `GeoJSON export failed: ${errorMessage(error)}` }));
      }
    } finally {
      anchor?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  }, [features, layers]);

  const strokes = useMemo(() => features.map(toRenderableStroke), [features]);

  return {
    features,
    layers,
    loading,
    operationNotice,
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

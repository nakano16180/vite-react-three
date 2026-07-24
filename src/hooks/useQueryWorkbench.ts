import { useCallback, useEffect, useRef, useState } from "react";
import { createQueryRuntime, type QueryResult, type QueryRuntime } from "../db/queryRuntime";
import type { GeometryFeature, Layer } from "../domain/geometryFeature";

export type QueryUiStatus = "initializing" | "ready" | "running" | "cancelled" | "empty" | "success" | "error";

export const SQL_EXAMPLES = [
  { label: "Filter features", sql: "SELECT id, geometry_type, layer_id FROM geometry_features ORDER BY feature_order" },
  {
    label: "Measure geometry",
    sql: "SELECT id, ST_Length(ST_GeomFromGeoJSON(geometry_geojson)) AS length FROM geometry_features",
  },
  {
    label: "Convert geometry",
    sql: "SELECT id, ST_AsText(ST_GeomFromGeoJSON(geometry_geojson)) AS geometry_wkt FROM geometry_features",
  },
] as const;

export function useQueryWorkbench(features: GeometryFeature[], layers: Layer[], storageLoading: boolean) {
  const runtimeRef = useRef<QueryRuntime | null>(null);
  const requestRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const [sql, setSql] = useState<string>(SQL_EXAMPLES[0].sql);
  const [history, setHistory] = useState<string[]>([]);
  const [status, setStatus] = useState<QueryUiStatus>("initializing");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (storageLoading) return;
    const snapshot = { features, layers };
    queueRef.current = queueRef.current.then(async () => {
      try {
        if (runtimeRef.current) await runtimeRef.current.refresh(snapshot);
        else runtimeRef.current = await createQueryRuntime(snapshot);
        setStatus("ready");
        setError(undefined);
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }, [features, layers, storageLoading]);

  useEffect(
    () => () => {
      requestRef.current += 1;
      void runtimeRef.current?.dispose();
      runtimeRef.current = null;
    },
    []
  );

  const execute = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const request = ++requestRef.current;
    setStatus("running");
    setError(undefined);
    setHistory((current) => [sql, ...current.filter((entry) => entry !== sql)].slice(0, 10));
    try {
      const next = await runtime.execute(sql);
      if (request !== requestRef.current || !next) return;
      setResult(next);
      setStatus(next.status);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setResult(null);
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sql]);

  const cancel = useCallback(async () => {
    requestRef.current += 1;
    await runtimeRef.current?.cancel();
    setStatus("cancelled");
  }, []);

  return { cancel, error, execute, history, result, setSql, sql, status };
}

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import { bundle } from "../dbBundles";
import { getPolygonArea, getPolygonPerimeter, getPolylineLength, pointsEqual, type Point2D } from "../lib/geometry";

export type GeometryType = "line" | "polygon";

export interface Stroke {
  id: string;
  color: string;
  width: number;
  ptsPx: Point2D[];
  geomType: GeometryType;
  length?: number;
  area?: number;
  perimeter?: number;
}

const toLineWKT = (ptsPx: Point2D[]) => {
  const filtered = ptsPx.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const body = filtered.map(([x, y]) => `${x} ${y}`).join(", ");
  return `LINESTRING(${body})`;
};

const toPolygonWKT = (ptsPx: Point2D[]) => {
  const filtered = ptsPx.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const closed =
    filtered.length > 0 && !pointsEqual(filtered[0], filtered[filtered.length - 1])
      ? [...filtered, filtered[0]]
      : filtered;
  const body = closed.map(([x, y]) => `${x} ${y}`).join(", ");
  return `POLYGON((${body}))`;
};

const toWKT = (ptsPx: Point2D[], type: GeometryType) => (type === "polygon" ? toPolygonWKT(ptsPx) : toLineWKT(ptsPx));

const parseGeometryFromGeoJSON = (
  gj: { type?: string; coordinates?: [number, number][] | [number, number][][] },
  type: GeometryType
): Point2D[] => {
  let coordinates: Point2D[];
  if (type === "polygon") {
    if (gj.type !== "Polygon" || !gj.coordinates) return [];
    coordinates = gj.coordinates[0] as Point2D[];
  } else {
    if (gj.type !== "LineString" || !gj.coordinates) return [];
    coordinates = gj.coordinates as Point2D[];
  }
  const points = coordinates.map((c) => [c[0], c[1]] as Point2D);
  if (type === "polygon" && points.length > 1 && pointsEqual(points[0], points[points.length - 1])) {
    points.pop();
  }
  return points;
};

const toStr = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const toGeometryType = (v: unknown): GeometryType => (toStr(v) === "polygon" ? "polygon" : "line");
const newStrokeId = () => crypto?.randomUUID?.() || Math.random().toString(36).slice(2);

type GeoJSONLineString = {
  type: "LineString";
  coordinates: Point2D[];
};

type GeoJSONPolygon = {
  type: "Polygon";
  coordinates: Point2D[][];
};

type SupportedGeoJSONGeometry = GeoJSONLineString | GeoJSONPolygon;

type GeoJSONFeature = {
  type: "Feature";
  geometry: SupportedGeoJSONGeometry | null;
  properties?: Record<string, unknown> | null;
};

type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
};

type GeoJSONInput = GeoJSONFeature | GeoJSONFeatureCollection;

const isPoint2D = (value: unknown): value is Point2D =>
  Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);

const normalizePoints = (coordinates: unknown): Point2D[] => {
  if (!Array.isArray(coordinates)) return [];
  return coordinates.filter(isPoint2D).map(([x, y]) => [x, y]);
};

const toGeoJSONGeometry = (ptsPx: Point2D[], geomType: GeometryType): SupportedGeoJSONGeometry => {
  if (geomType === "polygon") {
    const closed = ptsPx.length > 0 && !pointsEqual(ptsPx[0], ptsPx[ptsPx.length - 1]) ? [...ptsPx, ptsPx[0]] : ptsPx;
    return { type: "Polygon", coordinates: [closed] };
  }
  return { type: "LineString", coordinates: ptsPx };
};

const normalizeImportedGeometry = (
  geometry: unknown
): { geomType: GeometryType; geometry: SupportedGeoJSONGeometry; ptsPx: Point2D[] } | null => {
  if (!geometry || typeof geometry !== "object") return null;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type === "LineString") {
    const ptsPx = normalizePoints(candidate.coordinates);
    if (ptsPx.length < 2) return null;
    return { geomType: "line", geometry: { type: "LineString", coordinates: ptsPx }, ptsPx };
  }
  if (candidate.type === "Polygon") {
    const rings = Array.isArray(candidate.coordinates) ? candidate.coordinates : [];
    const ptsPx = normalizePoints(rings[0]);
    if (ptsPx.length > 1 && pointsEqual(ptsPx[0], ptsPx[ptsPx.length - 1])) {
      ptsPx.pop();
    }
    if (ptsPx.length < 3) return null;
    return { geomType: "polygon", geometry: toGeoJSONGeometry(ptsPx, "polygon") as GeoJSONPolygon, ptsPx };
  }
  return null;
};

const toFeatureCollection = (input: unknown): GeoJSONFeatureCollection | null => {
  if (!input || typeof input !== "object") return null;
  const candidate = input as GeoJSONInput;
  if (candidate.type === "FeatureCollection" && Array.isArray(candidate.features)) {
    return { type: "FeatureCollection", features: candidate.features };
  }
  if (candidate.type === "Feature") {
    return { type: "FeatureCollection", features: [candidate] };
  }
  return null;
};

const checkpoint = async (conn: duckdb.AsyncDuckDBConnection) => {
  try {
    await conn.query(`CHECKPOINT;`);
  } catch (e) {
    console.warn("CHECKPOINT failed:", e);
  }
};

export function useDuckDBStrokes(strokeColor: string, strokeWidth: number, simplifyOn: boolean) {
  const [dbConn, setDbConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [spatialLoaded, setSpatialLoaded] = useState(false);
  const [opfsLoaded, setOpfsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const worker = new Worker(bundle.mainWorker!, { type: "module" });
        const logger = new duckdb.ConsoleLogger();
        const _db = new duckdb.AsyncDuckDB(logger, worker);
        await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);

        let opfsOK = false;
        try {
          await _db.open({
            path: "opfs://vite-react-three.duckdb",
            accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
          });
          opfsOK = true;
        } catch (e) {
          console.warn("OPFS not available, using in-memory database:", e);
        }

        const _conn = await _db.connect();

        let spatialOK = false;
        try {
          await _conn.query(`INSTALL spatial;`);
          await _conn.query(`LOAD spatial;`);
          setSpatialLoaded(true);
          spatialOK = true;
        } catch (e) {
          console.warn("spatial extension load failed:", e);
          setSpatialLoaded(false);
        }

        await _conn.query(`
          CREATE TABLE IF NOT EXISTS strokes_json (
            id    TEXT PRIMARY KEY,
            coords JSON,
            color VARCHAR,
            width DOUBLE,
            geom_type VARCHAR DEFAULT 'line',
            created_at TIMESTAMP DEFAULT now()
          );
        `);
        await _conn.query(`ALTER TABLE strokes_json ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line';`);

        if (spatialOK) {
          await _conn.query(`
          CREATE TABLE IF NOT EXISTS strokes (
            id    TEXT PRIMARY KEY,
            geom  GEOMETRY,
            color VARCHAR,
            width DOUBLE,
            geom_type VARCHAR DEFAULT 'line',
            created_at TIMESTAMP DEFAULT now()
          );
        `);
          await _conn.query(`ALTER TABLE strokes ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line';`);
        }

        if (!cancelled) {
          setDbConn(_conn);
          setOpfsLoaded(opfsOK);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadFromDB = useCallback(async () => {
    if (!dbConn) return;
    const list: Stroke[] = [];

    if (spatialLoaded) {
      const res = await dbConn.query(`
        SELECT id, color, width, geom_type, ST_AsGeoJSON(geom) AS gj,
               CASE WHEN geom_type = 'line' THEN ST_Length(geom) END AS length,
               CASE WHEN geom_type = 'polygon' THEN ST_Area(geom) END AS area
        FROM strokes
        ORDER BY created_at ASC;
      `);
      const rows = res.toArray();
      for (const row of rows) {
        const obj = row.toJSON() as Record<string, unknown>;
        const id = toStr(obj["id"]);
        const color = toStr(obj["color"]) || "#222";
        const widthRaw = toNum(obj["width"]);
        const width = Number.isFinite(widthRaw) ? widthRaw : 3;
        const geomType = toGeometryType(obj["geom_type"]);
        const lengthRaw = toNum(obj["length"]);
        const areaRaw = toNum(obj["area"]);
        const gj = JSON.parse(toStr(obj["gj"]));
        const ptsPx = parseGeometryFromGeoJSON(gj, geomType);
        list.push({
          id,
          color,
          width,
          geomType,
          length: Number.isFinite(lengthRaw) ? lengthRaw : getPolylineLength(ptsPx),
          area: geomType === "polygon" ? (Number.isFinite(areaRaw) ? areaRaw : getPolygonArea(ptsPx)) : undefined,
          perimeter: geomType === "polygon" ? getPolygonPerimeter(ptsPx) : undefined,
          ptsPx,
        });
      }
    }

    const resJ = await dbConn.query(`
      SELECT id, color, width, coords, geom_type
      FROM strokes_json
      ORDER BY created_at ASC;
    `);
    const rowsJ = resJ.toArray();
    for (const row of rowsJ) {
      const obj = row.toJSON() as Record<string, unknown>;
      const id = toStr(obj["id"]);
      const color = toStr(obj["color"]) || "#222";
      const widthRaw = toNum(obj["width"]);
      const width = Number.isFinite(widthRaw) ? widthRaw : 3;
      const geomType = toGeometryType(obj["geom_type"]);
      const coordsStr = toStr(obj["coords"]);
      let pts: Point2D[] = [];
      try {
        const a = JSON.parse(coordsStr);
        if (Array.isArray(a)) pts = a as Point2D[];
      } catch {
        // Ignore parsing errors, use empty array
      }
      list.push({
        id,
        color,
        width,
        geomType,
        length: getPolylineLength(pts),
        area: geomType === "polygon" ? getPolygonArea(pts) : undefined,
        perimeter: geomType === "polygon" ? getPolygonPerimeter(pts) : undefined,
        ptsPx: pts,
      });
    }

    setStrokes(list);
  }, [dbConn, spatialLoaded]);

  useEffect(() => {
    if (!dbConn) return;
    void reloadFromDB();
  }, [dbConn, reloadFromDB]);

  const handleUndo = useCallback(async () => {
    if (!dbConn) return;
    if (spatialLoaded) {
      await dbConn.query(`
        DELETE FROM strokes WHERE id IN (
          SELECT id FROM strokes ORDER BY created_at DESC LIMIT 1
        );
      `);
    } else {
      await dbConn.query(`
        DELETE FROM strokes_json WHERE id IN (
          SELECT id FROM strokes_json ORDER BY created_at DESC LIMIT 1
        );
      `);
    }
    await reloadFromDB();
    await checkpoint(dbConn);
  }, [dbConn, reloadFromDB, spatialLoaded]);

  const handleClear = useCallback(async () => {
    if (!dbConn) return;
    if (spatialLoaded) {
      await dbConn.query(`DELETE FROM strokes;`);
    }
    await dbConn.query(`DELETE FROM strokes_json;`);
    await reloadFromDB();
    await checkpoint(dbConn);
  }, [dbConn, reloadFromDB, spatialLoaded]);

  const handleExportGeoJSON = useCallback(async () => {
    if (!dbConn) return;

    const features: GeoJSONFeature[] = [];
    if (spatialLoaded) {
      const res = await dbConn.query(`
        SELECT id, color, width, geom_type, ST_AsGeoJSON(geom) AS geometry
        FROM strokes
        ORDER BY created_at ASC;
      `);
      for (const row of res.toArray()) {
        const obj = row.toJSON() as Record<string, unknown>;
        const geometry = normalizeImportedGeometry(JSON.parse(toStr(obj["geometry"])));
        if (!geometry) continue;
        features.push({
          type: "Feature",
          geometry: geometry.geometry,
          properties: {
            id: toStr(obj["id"]),
            color: toStr(obj["color"]) || "#222222",
            width: Number.isFinite(toNum(obj["width"])) ? toNum(obj["width"]) : 3,
            geomType: toGeometryType(obj["geom_type"]),
          },
        });
      }
    }

    const resJ = await dbConn.query(`
      SELECT id, color, width, coords, geom_type
      FROM strokes_json
      ORDER BY created_at ASC;
    `);
    for (const row of resJ.toArray()) {
      const obj = row.toJSON() as Record<string, unknown>;
      const geomType = toGeometryType(obj["geom_type"]);
      const ptsPx = normalizePoints(JSON.parse(toStr(obj["coords"])));
      if (ptsPx.length < (geomType === "polygon" ? 3 : 2)) continue;
      features.push({
        type: "Feature",
        geometry: toGeoJSONGeometry(ptsPx, geomType),
        properties: {
          id: toStr(obj["id"]),
          color: toStr(obj["color"]) || "#222222",
          width: Number.isFinite(toNum(obj["width"])) ? toNum(obj["width"]) : 3,
          geomType,
        },
      });
    }

    const featureCollection: GeoJSONFeatureCollection = { type: "FeatureCollection", features };
    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `strokes-${new Date().toISOString().slice(0, 10)}.geojson`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [dbConn, spatialLoaded]);

  const handleImportGeoJSON = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!dbConn || !file) return;

      try {
        const parsed = JSON.parse(await file.text());
        const featureCollection = toFeatureCollection(parsed);
        if (!featureCollection) {
          alert("Please select a GeoJSON FeatureCollection or Feature file.");
          return;
        }

        let importedCount = 0;
        for (const feature of featureCollection.features) {
          if (!feature || feature.type !== "Feature") continue;
          const imported = normalizeImportedGeometry(feature.geometry);
          if (!imported) continue;

          const properties = feature.properties ?? {};
          const widthRaw = toNum(properties.width);
          const width = Number.isFinite(widthRaw) ? widthRaw : 3;
          const color = toStr(properties.color) || "#222222";
          const id = newStrokeId();

          if (spatialLoaded) {
            const insert = await dbConn.prepare(
              `INSERT INTO strokes(id, geom, color, width, geom_type) VALUES (?, ST_GeomFromGeoJSON(CAST(? AS VARCHAR)), ?, ?, ?);`
            );
            await insert.query(id, JSON.stringify(imported.geometry), color, width, imported.geomType);
            await insert.close();
          } else {
            const insertJ = await dbConn.prepare(
              `INSERT INTO strokes_json(id, coords, color, width, geom_type) VALUES (?, ?, ?, ?, ?);`
            );
            await insertJ.query(id, JSON.stringify(imported.ptsPx), color, width, imported.geomType);
            await insertJ.close();
          }
          importedCount += 1;
        }

        if (importedCount === 0) {
          alert("No supported LineString or Polygon features were found.");
          return;
        }
        await reloadFromDB();
        await checkpoint(dbConn);
      } catch (error) {
        console.error("GeoJSON import failed:", error);
        alert("Failed to import GeoJSON. Please check the file format.");
      }
    },
    [dbConn, reloadFromDB, spatialLoaded]
  );

  const updateStroke = useCallback(
    async (strokeId: string, newPtsPx: Point2D[]) => {
      if (!dbConn || newPtsPx.length < 2) return;
      if (spatialLoaded) {
        const stroke = strokes.find(({ id }) => id === strokeId);
        const geomType = stroke?.geomType ?? "line";
        const wkt = String(toWKT(newPtsPx, geomType));
        const upd = await dbConn.prepare(`UPDATE strokes SET geom = ST_GeomFromText(CAST(? AS VARCHAR)) WHERE id = ?;`);
        await upd.query(wkt, strokeId);
        await upd.close();
      }
      const updJ = await dbConn.prepare(`UPDATE strokes_json SET coords = ? WHERE id = ?;`);
      await updJ.query(JSON.stringify(newPtsPx), strokeId);
      await updJ.close();
      await reloadFromDB();
      await checkpoint(dbConn);
    },
    [dbConn, reloadFromDB, spatialLoaded, strokes]
  );

  const persistStroke = useCallback(
    async (ptsPx: Point2D[], geomType: GeometryType) => {
      if (!dbConn || ptsPx.length < (geomType === "polygon" ? 3 : 2)) return;

      if (spatialLoaded) {
        const wkt = String(toWKT(ptsPx, geomType));
        const newId = newStrokeId();

        const insert = await dbConn.prepare(
          `INSERT INTO strokes(id, geom, color, width, geom_type) VALUES (?, ST_GeomFromText(CAST(? AS VARCHAR)), ?, ?, ?);`
        );
        await insert.query(newId, wkt, strokeColor, strokeWidth, geomType);
        await insert.close();

        if (simplifyOn) {
          const upd = await dbConn.prepare(`UPDATE strokes SET geom = ST_Simplify(geom, ?) WHERE id = ?;`);
          await upd.query(Math.max(0, Math.min(strokeWidth * 0.3, 3)), newId);
          await upd.close();
        }
      } else {
        const newId = newStrokeId();
        const insertJ = await dbConn.prepare(
          `INSERT INTO strokes_json(id, coords, color, width, geom_type) VALUES (?, ?, ?, ?, ?);`
        );
        await insertJ.query(newId, JSON.stringify(ptsPx), strokeColor, strokeWidth, geomType);
        await insertJ.close();
      }

      await reloadFromDB();
      await checkpoint(dbConn);
    },
    [dbConn, reloadFromDB, simplifyOn, spatialLoaded, strokeColor, strokeWidth]
  );

  return {
    handleClear,
    handleExportGeoJSON,
    handleImportGeoJSON,
    handleRefresh: reloadFromDB,
    handleUndo,
    loading,
    opfsLoaded,
    persistStroke,
    spatialLoaded,
    strokes,
    updateStroke,
  };
}

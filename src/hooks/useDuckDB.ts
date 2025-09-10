import { useEffect, useState } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import { bundle } from "../dbBundles";
import { toWKT, parseLineStringFromGeoJSON, toStr, toNum } from "../utils/geometry";
import type { Stroke } from "../types";

export function useDuckDB() {
  const [dbConn, setDbConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [spatialLoaded, setSpatialLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  // DuckDB 初期化
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const worker = new Worker(bundle.mainWorker!, { type: "module" });
        const logger = new duckdb.ConsoleLogger();
        const _db = new duckdb.AsyncDuckDB(logger, worker);
        await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);
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

        // フォールバック用の JSON テーブルは常に用意
        await _conn.query(`
          CREATE TABLE IF NOT EXISTS strokes_json (
            id    TEXT PRIMARY KEY,
            coords JSON,
            color VARCHAR,
            width DOUBLE,
            created_at TIMESTAMP DEFAULT now()
          );
        `);

        // spatial が使える環境では GEOMETRY テーブルも作成
        // id は TEXT にして、ブラウザ側で UUID を付与（uuid 拡張不要）
        if (spatialOK){
        await _conn.query(`
          CREATE TABLE IF NOT EXISTS strokes (
            id    TEXT PRIMARY KEY,
            geom  GEOMETRY,
            color VARCHAR,
            width DOUBLE,
            created_at TIMESTAMP DEFAULT now()
          );
        `);
        }

        if (!cancelled) setDbConn(_conn);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // DB → strokes を読み直し
  const reloadFromDB = async () => {
    if (!dbConn) return;
    const list: Stroke[] = [];

    if (spatialLoaded){
      const res = await dbConn.query(`
        SELECT id, color, width, ST_AsGeoJSON(geom) AS gj
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
        const gj = JSON.parse(toStr(obj["gj"]));
        list.push({ id, color, width, ptsPx: parseLineStringFromGeoJSON(gj) });
      }
    }

    // JSON 方式（フォールバック/併用）
    const resJ = await dbConn.query(`
      SELECT id, color, width, coords
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
      const coordsStr = toStr(obj["coords"]);
      let pts: [number, number][] = [];
      try {
        const a = JSON.parse(coordsStr);
        if (Array.isArray(a)) pts = a as [number, number][];
      } catch {
        // Ignore parsing errors, use empty array
      }
      list.push({ id, color, width, ptsPx: pts });
    }

    setStrokes(list);
  };

  useEffect(() => {
    if (!dbConn) return;
    reloadFromDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbConn, spatialLoaded]);

  // 直前のストローク削除（Undo）
  const handleUndo = async () => {
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
  };

  const handleClear = async () => {
    if (!dbConn) return;
    if (spatialLoaded) {
      await dbConn.query(`DELETE FROM strokes;`);
    }
    await dbConn.query(`DELETE FROM strokes_json;`);
    await reloadFromDB();
  };

  const handleRefresh = async () => reloadFromDB();

  // ドラッグ終了時に DB に保存
  const persistStroke = async (ptsPx: [number, number][], strokeColor: string, strokeWidth: number, simplifyOn: boolean) => {
    if (!dbConn || ptsPx.length < 2) return;

    if (spatialLoaded) {
      const wkt = String(toWKT(ptsPx));
      const newId = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);

      const insert = await dbConn.prepare(
        `INSERT INTO strokes(id, geom, color, width) VALUES (?, ST_GeomFromText(CAST(? AS VARCHAR)), ?, ?);`
      );
      await insert.query(newId, wkt, strokeColor, strokeWidth);
      await insert.close();

      if (simplifyOn) {
        const upd = await dbConn.prepare(
          `UPDATE strokes SET geom = ST_Simplify(geom, ?) WHERE id = ?;`
        );
        await upd.query(Math.max(0, Math.min(strokeWidth * 0.3, 3)), newId);
        await upd.close();
      }
    } else {
      const newId = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      const insertJ = await dbConn.prepare(
        `INSERT INTO strokes_json(id, coords, color, width) VALUES (?, ?, ?, ?);`
      );
      await insertJ.query(newId, JSON.stringify(ptsPx), strokeColor, strokeWidth);
      await insertJ.close();
    }

    await reloadFromDB();
  };

  return {
    dbConn,
    spatialLoaded,
    loading,
    strokes,
    handleUndo,
    handleClear,
    handleRefresh,
    persistStroke,
  };
}
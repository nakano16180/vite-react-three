import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as duckdb from "@duckdb/duckdb-wasm";
import { bundle } from "./dbBundles";


// DuckDB への保存は px 座標（画面座標）で行います
const toWKT = (ptsPx: [number, number][]) => {
  // 非数値/NaN を除外して WKT を生成
  const filtered = ptsPx.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const body = filtered.map(([x, y]) => `${x} ${y}`).join(", ");
  return `LINESTRING(${body})`;
};

const parseLineStringFromGeoJSON = (gj: any): [number, number][] => {
  if (!gj || gj.type !== "LineString") return [];
  return gj.coordinates.map((c: [number, number]) => [c[0], c[1]]);
};

const toStr = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v));

interface Stroke {
  id: string;
  color: string;
  width: number; // px 単位
  ptsPx: [number, number][]; // DB は px 座標で保持
}

export default function App() {
  const [dbConn, setDbConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [spatialLoaded, setSpatialLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  const [strokeColor, setStrokeColor] = useState("#222222");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [simplifyOn, setSimplifyOn] = useState(true);


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
        try {
          await _conn.query(`INSTALL spatial;`);
          await _conn.query(`LOAD spatial;`);
          setSpatialLoaded(true);
        } catch (e) {
          console.warn("spatial extension load failed:", e);
          setSpatialLoaded(false);
        }
        // id は TEXT にして、ブラウザ側で UUID を付与（uuid 拡張不要）
        await _conn.query(`
          CREATE TABLE IF NOT EXISTS strokes (
            id    TEXT PRIMARY KEY,
            geom  GEOMETRY,
            color VARCHAR,
            width DOUBLE,
            created_at TIMESTAMP DEFAULT now()
          );
        `);
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
    if (!dbConn || !spatialLoaded) return;
    const res = await dbConn.query(`
      SELECT id, color, width, ST_AsGeoJSON(geom) AS gj
      FROM strokes
      ORDER BY created_at ASC;
    `);
    const rows = res.toArray();
    const list: Stroke[] = [];
    for (const row of rows) {
      const obj = row.toJSON() as Record<string, unknown>;
      const id = toStr(obj["id"]);
      const color = toStr(obj["color"]) || "#222";
      const widthRaw = toNum(obj["width"]);
      const width = Number.isFinite(widthRaw) ? widthRaw : 3;
      const gj = JSON.parse(toStr(obj["gj"]));
      list.push({ id, color, width, ptsPx: parseLineStringFromGeoJSON(gj) });
    }

    setStrokes(list);
  };

  useEffect(() => {
    if (!dbConn || !spatialLoaded) return;
    reloadFromDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbConn, spatialLoaded]);

  // 直前のストローク削除（Undo）
  const handleUndo = async () => {
    if (!dbConn) return;
    await dbConn.query(`
      DELETE FROM strokes WHERE id IN (
        SELECT id FROM strokes ORDER BY created_at DESC LIMIT 1
      );
    `);
    await reloadFromDB();
  };

  const handleClear = async () => {
    if (!dbConn) return;
    await dbConn.query(`DELETE FROM strokes;`);
    await reloadFromDB();
  };

  const handleRefresh = async () => reloadFromDB();


// ドラッグ終了時に DB に保存
  const persistStroke = async (ptsPx: [number, number][]) => {
    if (!dbConn || !spatialLoaded || ptsPx.length < 2) return;
    const wkt = String(toWKT(ptsPx));  // 念のため明示的に文字列化
    const newId = (globalThis as any).crypto?.randomUUID
      ? (globalThis as any).crypto.randomUUID()
      : Math.random().toString(36).slice(2);

    console.debug("WKT typeof:", typeof wkt, "len:", wkt.length, wkt.slice(0, 80));

    // INSERT (prepared statement)
    const insert = await dbConn.prepare(`INSERT INTO strokes(id, geom, color, width)  VALUES (?, ST_GeomFromText(CAST(? AS VARCHAR)), ?, ?);`);
    await insert.query(newId, wkt, strokeColor, strokeWidth);
    await insert.close();

     if (simplifyOn) {
       const upd = await dbConn.prepare(`UPDATE strokes SET geom = ST_Simplify(geom, ?) WHERE id = ?;`);
      await upd.query(Math.max(0, Math.min(strokeWidth * 0.3, 3)), newId);
      await upd.close();
    }

    await reloadFromDB();
  };

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "#f5f5f5" }}>
      <header style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #e5e5e5", background: "#fff" }}>
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>DuckDB Spatial × R3F — Line Draw</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12 }}>色</label>
          <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} style={{ height: 32, width: 40 }} />
          <label style={{ fontSize: 12, marginLeft: 8 }}>太さ</label>
          <input type="range" min={1} max={24} value={strokeWidth} onChange={(e) => setStrokeWidth(parseInt(e.target.value))} />
          <label style={{ fontSize: 12, marginLeft: 8, display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={simplifyOn} onChange={(e) => setSimplifyOn(e.target.checked)} /> Simplify
          </label>
          <button onClick={handleUndo}>Undo</button>
          <button onClick={handleRefresh}>Refresh</button>
          <button onClick={handleClear} style={{ color: "#c00" }}>Clear</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: 12, minHeight: 0 }}>
        {/* 親は高さを持つだけ。装飾は持たせない */}
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {/* 1) Canvas は absolute で inset:0（%高さの連鎖を断つ） */}
          <div style={{ position: "absolute", inset: 0 }}>
            <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 1 }} style={{ width: "100%", height: "100%" }}>
              <color attach="background" args={["#ffffff"]} />
              <ambientLight intensity={0.5} />
              <Scene strokes={strokes} />
              <DrawingSurface onFinish={persistStroke} color={strokeColor} width={strokeWidth} />
            </Canvas>
          </div>

          {/* 2) ローディング/警告オーバーレイ（absolute） */}
          {loading && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, color: "#666" }}>
              DuckDB を初期化中…
            </div>
          )}
          {!loading && !spatialLoaded && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                color: "#b45309",
                padding: 16,
                textAlign: "center",
              }}
            >
              spatial 拡張のロードに失敗しました。環境によっては利用できない場合があります。<br />
              その場合、保存・再描画が動作しません（コンソールのログをご確認ください）。
            </div>
          )}
        </div>

        {/* 3) 枠の装飾は最後に重ねる（pointer-events: none で操作に干渉しない） */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: 16,
            boxShadow: "0 1px 8px rgba(0,0,0,.05)",
            border: "1px solid #e5e5e5",
          }}
        />
      </main>

      <footer style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "right" }}>左ドラッグで描画 / Undo・Clear はヘッダーから操作</footer>
    </div>
  );
}

function Scene({ strokes }: { strokes: Stroke[] }) {
  const { size, viewport } = useThree();

  const pxToWorld = (x: number, y: number): [number, number, number] => {
    const wx = (x / size.width) * viewport.width - viewport.width / 2;
    const wy = viewport.height / 2 - (y / size.height) * viewport.height;
    return [wx, wy, 0];
  };

  const strokeLines = useMemo(() => {
    return strokes.map((s) => ({
      id: s.id,
      color: s.color,
      width: s.width,
      points: s.ptsPx.map(([x, y]) => pxToWorld(x, y)),
    }));
  }, [strokes, size, viewport]);

  return (
    <group>
      {strokeLines.map((s) => (
        <Line key={s.id} points={s.points as any} color={s.color} lineWidth={s.width} />
      ))}
    </group>
  );
}

function DrawingSurface({ onFinish, color, width }: { onFinish: (ptsPx: [number, number][]) => void | Promise<void>; color: string; width: number; }) {
  const { size, viewport } = useThree();
  const [drawing, setDrawing] = useState(false);
  const [previewWorld, setPreviewWorld] = useState<[number, number, number][]>([]);
  const ptsPxRef = useRef<[number, number][]>([]);

  const worldToPx = (wx: number, wy: number): [number, number] => {
    const x = ((wx + viewport.width / 2) / viewport.width) * size.width;
    const y = ((viewport.height / 2 - wy) / viewport.height) * size.height;
    return [x, y];
  };

  const planeArgs = useMemo<[number, number]>(() => [viewport.width, viewport.height], [viewport]);

  const onPointerDown = (e: any) => {
    e.stopPropagation();
    setDrawing(true);
    const p = e.point as { x: number; y: number; z: number };
    setPreviewWorld([[p.x, p.y, 0]]);
    ptsPxRef.current = [worldToPx(p.x, p.y)];
  };

  const onPointerMove = (e: any) => {
    if (!drawing) return;
    const p = e.point as { x: number; y: number; z: number };
    setPreviewWorld((prev) => [...prev, [p.x, p.y, 0]]);
    ptsPxRef.current.push(worldToPx(p.x, p.y));
  };

  const onPointerUp = async () => {
    if (!drawing) return;
    setDrawing(false);
    const ptsPx = ptsPxRef.current.slice();
    ptsPxRef.current = [];
    setPreviewWorld([]);
    await onFinish(ptsPx);
  };

  return (
    <group>
      {previewWorld.length >= 2 && (
        <Line points={previewWorld as any} color={color} lineWidth={width} />
      )}
      <mesh
        position={[0, 0, 0]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <planeGeometry args={planeArgs} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
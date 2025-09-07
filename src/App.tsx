import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as duckdb from "@duckdb/duckdb-wasm";
import { bundle } from "./dbBundles";
import { PointCloud } from "./PointCloud";
import { parsePCDFile, type PointCloudData } from "./pcdParser";


// DuckDB への保存は px 座標（画面座標）で行います
const toWKT = (ptsPx: [number, number][]) => {
  // 非数値/NaN を除外して WKT を生成
  const filtered = ptsPx.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const body = filtered.map(([x, y]) => `${x} ${y}`).join(", ");
  return `LINESTRING(${body})`;
};

const parseLineStringFromGeoJSON = (gj: { type?: string; coordinates?: [number, number][] }): [number, number][] => {
  if (!gj || gj.type !== "LineString" || !gj.coordinates) return [];
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
  const [pointClouds, setPointClouds] = useState<PointCloudData[]>([]);

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

  // Handle PCD file loading
  const handleFileLoad = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pcd')) {
      alert('Please select a PCD file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const pointCloudData = parsePCDFile(content);
        if (pointCloudData) {
          setPointClouds(prev => [...prev, pointCloudData]);
        } else {
          alert('Failed to parse PCD file. Please check the file format.');
        }
      }
    };
    reader.readAsText(file);
    
    // Reset the input so the same file can be loaded again
    event.target.value = '';
  };

  const handleClearPointClouds = () => {
    setPointClouds([]);
  };


  // ドラッグ終了時に DB に保存
  const persistStroke = async (ptsPx: [number, number][]) => {
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


  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f5f5f5" }}>
      <header style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #e5e5e5", background: "#fff" }}>
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>DuckDB Spatial × R3F — Line Draw & PCD Viewer</h1>
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
          
          {/* PCD File Loading */}
          <div style={{ marginLeft: 16, borderLeft: "1px solid #e5e5e5", paddingLeft: 16, display: "flex", gap: 8, alignItems: "center" }}>
            <label htmlFor="pcd-file-input" style={{ cursor: "pointer", padding: "4px 8px", backgroundColor: "#007bff", color: "white", borderRadius: 4, fontSize: 12 }}>
              Load PCD File
            </label>
            <input 
              id="pcd-file-input"
              type="file" 
              accept=".pcd"
              onChange={handleFileLoad} 
              style={{ display: "none" }}
            />
            {pointClouds.length > 0 && (
              <>
                <span style={{ fontSize: 12, color: "#666" }}>
                  {pointClouds.length} cloud{pointClouds.length > 1 ? 's' : ''} loaded
                </span>
                <button onClick={handleClearPointClouds} style={{ color: "#c00", fontSize: 12 }}>Clear Clouds</button>
              </>
            )}
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: 12, minHeight: 0 }}>
        {/* 親は高さを持つだけ。装飾は持たせない */}
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {/* Canvas は absolute で inset:0（%高さ連鎖を断つ） */}
          <div style={{ position: "absolute", inset: 0 }}>
            <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 1 }} style={{ width: "100%", height: "100%" }}>
              <color attach="background" args={["#ffffff"]} />
              <ambientLight intensity={0.5} />
              {/* 画面操作 */}
              <OrbitControls makeDefault enableRotate={false} />

              <Scene strokes={strokes} pointClouds={pointClouds} />
              <DrawingSurface onFinish={persistStroke} color={strokeColor} width={strokeWidth} />
            </Canvas>
          </div>

          {/* ローディング/警告オーバーレイ */}
          {loading && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, color: "#666" }}>DuckDB を初期化中…</div>
          )}
          {!loading && !spatialLoaded && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, color: "#b45309", padding: 16, textAlign: "center" }}>
              spatial 拡張のロードに失敗しました。環境によっては利用できない場合があります。<br />
              その場合、保存・再描画が動作しません（コンソールのログをご確認ください）。
            </div>
          )}

          {/* 枠の装飾はオーバーレイに分離 */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 16, boxShadow: "0 1px 8px rgba(0,0,0,.05)", border: "1px solid #e5e5e5" }} />
        </div>
      </main>

      <footer style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "right" }}>左ドラッグで描画 / パン・ズーム可（ホイール/ドラッグ） / Undo・Clear はヘッダーから / PCDファイル読み込み対応</footer>
    </div>
  );
}

function Scene({ strokes, pointClouds }: { strokes: Stroke[], pointClouds: PointCloudData[] }) {
  const { size, viewport } = useThree();

  const strokeLines = useMemo(() => {
    const pxToWorld = (x: number, y: number): [number, number, number] => {
      const wx = (x / size.width) * viewport.width - viewport.width / 2;
      const wy = viewport.height / 2 - (y / size.height) * viewport.height;
      return [wx, wy, 0];
    };
    
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
        <Line key={s.id} points={s.points} color={s.color} lineWidth={s.width} />
      ))}
      {pointClouds.map((cloud, index) => (
        <PointCloud key={`cloud-${index}`} data={cloud} pointSize={0.5} />
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
  
  // 近すぎる点をスキップして無駄な頂点を減らす
  const MIN_DIST = 1.5; // px

  const planeArgs = useMemo<[number, number]>(() => [viewport.width, viewport.height], [viewport]);

  const onPointerDown = (e: { stopPropagation: () => void; point: { x: number; y: number; z: number } }) => {
    e.stopPropagation();
    setDrawing(true);
    const p = e.point;
    setPreviewWorld([[p.x, p.y, 0]]);
    ptsPxRef.current = [worldToPx(p.x, p.y)];
  };

  const onPointerMove = (e: { point: { x: number; y: number; z: number } }) => {
    if (!drawing) return;
    const p = e.point;
    const [x, y] = worldToPx(p.x, p.y);
    const last = ptsPxRef.current[ptsPxRef.current.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) >= MIN_DIST) {
      ptsPxRef.current.push([x, y]);
      setPreviewWorld((prev) => [...prev, [p.x, p.y, 0]]);
    }
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
        <Line points={previewWorld} color={color} lineWidth={width} />
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
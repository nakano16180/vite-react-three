import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as duckdb from "@duckdb/duckdb-wasm";
import { bundle } from "./dbBundles";
import { Header } from "./components/Header";
import { Scene } from "./components/Scene";
import { DrawingSurface } from "./components/DrawingSurface";
import { MapView } from "./components/MapView";

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

type InteractionMode = "draw" | "pan";

export default function App() {
  const [dbConn, setDbConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [spatialLoaded, setSpatialLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pcdFileContents, setPcdFileContents] = useState<string[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("draw");

  const [strokeColor, setStrokeColor] = useState("#222222");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [simplifyOn, setSimplifyOn] = useState(true);
  const [showMap, setShowMap] = useState(false);

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
        if (spatialOK) {
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

    if (spatialLoaded) {
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

    if (!file.name.toLowerCase().endsWith(".pcd")) {
      alert("Please select a PCD file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setPcdFileContents((prev) => [...prev, content]);
      }
    };
    reader.readAsText(file);

    // Reset the input so the same file can be loaded again
    event.target.value = "";
  };

  const handleClearPointClouds = () => {
    setPcdFileContents([]);
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
        const upd = await dbConn.prepare(`UPDATE strokes SET geom = ST_Simplify(geom, ?) WHERE id = ?;`);
        await upd.query(Math.max(0, Math.min(strokeWidth * 0.3, 3)), newId);
        await upd.close();
      }
    } else {
      const newId = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      const insertJ = await dbConn.prepare(`INSERT INTO strokes_json(id, coords, color, width) VALUES (?, ?, ?, ?);`);
      await insertJ.query(newId, JSON.stringify(ptsPx), strokeColor, strokeWidth);
      await insertJ.close();
    }

    await reloadFromDB();
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#f5f5f5",
      }}
    >
      <Header
        interactionMode={interactionMode}
        setInteractionMode={setInteractionMode}
        strokeColor={strokeColor}
        setStrokeColor={setStrokeColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        simplifyOn={simplifyOn}
        setSimplifyOn={setSimplifyOn}
        handleUndo={handleUndo}
        handleRefresh={handleRefresh}
        handleClear={handleClear}
        handleFileLoad={handleFileLoad}
        handleClearPointClouds={handleClearPointClouds}
        pcdFileContents={pcdFileContents}
        showMap={showMap}
        setShowMap={setShowMap}
      />

      <main style={{ flex: 1, padding: 12, minHeight: 0 }}>
        {/* 親は高さを持つだけ。装飾は持たせない */}
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {/* Canvas は absolute で inset:0（%高さ連鎖を断つ） */}
          <div style={{ position: "absolute", inset: 0 }}>
            {showMap ? (
              <MapView visible={showMap} />
            ) : (
              <Canvas
                orthographic
                camera={{ position: [0, 0, 100], zoom: 1 }}
                style={{ width: "100%", height: "100%" }}
              >
                <color attach="background" args={["#ffffff"]} />
                <ambientLight intensity={0.5} />
                {/* 画面操作 - OrbitControls behavior changes based on interaction mode */}
                <OrbitControls makeDefault enableRotate={false} enabled={interactionMode === "pan"} />

                <Scene pcdFileContents={pcdFileContents} strokes={strokes} />
                <DrawingSurface
                  onFinish={persistStroke}
                  color={strokeColor}
                  width={strokeWidth}
                  enabled={interactionMode === "draw"}
                />
              </Canvas>
            )}
          </div>

          {/* ローディング/警告オーバーレイ */}
          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                color: "#666",
              }}
            >
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
              spatial 拡張のロードに失敗しました。環境によっては利用できない場合があります。
              <br />
              その場合、保存・再描画が動作しません（コンソールのログをご確認ください）。
            </div>
          )}

          {/* 枠の装飾はオーバーレイに分離 */}
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
        </div>
      </main>

      <footer style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "right" }}>
        Draw モード: 左ドラッグで描画 | Pan モード: ドラッグで移動・ホイールでズーム | PCDファイル読み込み対応 |
        Undo・Clear はヘッダーから
      </footer>
    </div>
  );
}

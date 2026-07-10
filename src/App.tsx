import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Header } from "./components/Header";
import { Scene } from "./components/Scene";
import { DrawingSurface } from "./components/DrawingSurface";
import { MapView } from "./components/MapView";
import { StrokeEditor } from "./components/StrokeEditor";
import { useDuckDBStrokes, type Stroke } from "./hooks/useDuckDBStrokes";
import type { Point2D } from "./lib/geometry";

type InteractionMode = "draw" | "pan" | "edit" | "measure";

interface WorkspaceProps {
  interactionMode: InteractionMode;
  loading: boolean;
  pcdFileContents: string[];
  showMap: boolean;
  spatialLoaded: boolean;
  strokeColor: string;
  strokeWidth: number;
  strokes: Stroke[];
  onFinishStroke: ReturnType<typeof useDuckDBStrokes>["persistStroke"];
  onUpdateStroke: (strokeId: string, newPtsPx: Point2D[]) => Promise<void>;
}

function Workspace({
  interactionMode,
  loading,
  pcdFileContents,
  showMap,
  spatialLoaded,
  strokeColor,
  strokeWidth,
  strokes,
  onFinishStroke,
  onUpdateStroke,
}: WorkspaceProps) {
  return (
    <main style={{ flex: 1, padding: 12, minHeight: 0 }}>
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          {showMap ? (
            <MapView visible={showMap} />
          ) : (
            <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 1 }} style={{ width: "100%", height: "100%" }}>
              <color attach="background" args={["#ffffff"]} />
              <ambientLight intensity={0.5} />
              <OrbitControls makeDefault enableRotate={false} enabled={interactionMode === "pan"} />

              <Scene
                pcdFileContents={pcdFileContents}
                strokes={strokes}
                hideStrokes={interactionMode === "edit"}
                showMeasurements={interactionMode === "measure"}
              />
              <StrokeEditor strokes={strokes} onUpdateStroke={onUpdateStroke} enabled={interactionMode === "edit"} />
              <DrawingSurface
                onFinish={onFinishStroke}
                color={strokeColor}
                width={strokeWidth}
                enabled={interactionMode === "draw"}
              />
            </Canvas>
          )}
        </div>

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
          <div className="workspace-warning-overlay">
            spatial 拡張のロードに失敗しました。環境によっては利用できない場合があります。
            <br />
            その場合、保存・再描画が動作しません（コンソールのログをご確認ください）。
          </div>
        )}

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
  );
}

function StatusFooter({ opfsLoaded }: { opfsLoaded: boolean }) {
  return (
    <footer style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "right" }}>
      {opfsLoaded ? (
        <span style={{ color: "#16a34a", marginRight: 8 }}>💾 データ永続化中 (OPFS)</span>
      ) : (
        <span style={{ color: "#b45309", marginRight: 8 }}>⚠️ メモリのみ（リロードでリセット）</span>
      )}
      Draw モード: クリックで点を追加・Escまたはダブルクリックで確定 | Measure モード: 長さ・面積・周長を表示 | Edit
      モード: 点をドラッグで移動 | Pan モード: ドラッグで移動・ホイールでズーム | PCDファイル読み込み対応 | Undo・Clear
      はヘッダーから
    </footer>
  );
}

export default function App() {
  const [pcdFileContents, setPcdFileContents] = useState<string[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("draw");
  const [strokeColor, setStrokeColor] = useState("#222222");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [simplifyOn, setSimplifyOn] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const {
    handleClear,
    handleExportGeoJSON,
    handleImportGeoJSON,
    handleRefresh,
    handleUndo,
    loading,
    opfsLoaded,
    persistStroke,
    spatialLoaded,
    strokes,
    updateStroke,
  } = useDuckDBStrokes(strokeColor, strokeWidth, simplifyOn);

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
    event.target.value = "";
  };

  const handleClearPointClouds = () => {
    setPcdFileContents([]);
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
        handleExportGeoJSON={handleExportGeoJSON}
        handleImportGeoJSON={handleImportGeoJSON}
        handleFileLoad={handleFileLoad}
        handleClearPointClouds={handleClearPointClouds}
        pcdFileContents={pcdFileContents}
        showMap={showMap}
        setShowMap={setShowMap}
      />

      <Workspace
        interactionMode={interactionMode}
        loading={loading}
        pcdFileContents={pcdFileContents}
        showMap={showMap}
        spatialLoaded={spatialLoaded}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        strokes={strokes}
        onFinishStroke={persistStroke}
        onUpdateStroke={updateStroke}
      />

      <StatusFooter opfsLoaded={opfsLoaded} />
    </div>
  );
}

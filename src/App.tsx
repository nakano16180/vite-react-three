import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Header } from "./components/Header";
import { Scene } from "./components/Scene";
import { DrawingSurface } from "./components/DrawingSurface";
import { StrokeEditor } from "./components/StrokeEditor";
import { PanControls } from "./components/PanControls";
import { SqlWorkbench } from "./components/SqlWorkbench";
import type { RenderableStroke } from "./domain/renderableStroke";
import { useGeometryFeatures, type StorageStatus } from "./hooks/useGeometryFeatures";
import type { Point2D } from "./domain/geometryFeature";
import { useQueryWorkbench } from "./hooks/useQueryWorkbench";

type InteractionMode = "draw" | "pan" | "edit" | "measure";

interface WorkspaceProps {
  interactionMode: InteractionMode;
  loading: boolean;
  operationNotice?: string;
  storageStatus: StorageStatus;
  strokeColor: string;
  strokeWidth: number;
  strokes: RenderableStroke[];
  temporaryStrokes: RenderableStroke[];
  onFinishStroke: ReturnType<typeof useGeometryFeatures>["persistStroke"];
  onUpdateStroke: (strokeId: string, newPtsPx: Point2D[]) => Promise<void>;
}

function Workspace({
  interactionMode,
  loading,
  operationNotice,
  storageStatus,
  strokeColor,
  strokeWidth,
  strokes,
  temporaryStrokes,
  onFinishStroke,
  onUpdateStroke,
}: WorkspaceProps) {
  return (
    <main data-testid="workspace" style={{ flex: 1, padding: 12, minHeight: 0 }}>
      <div data-testid="canvas-workspace" style={{ position: "relative", width: "100%", height: "100%" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <Canvas
            data-testid="drawing-canvas"
            orthographic
            camera={{ position: [0, 0, 100], zoom: 1 }}
            style={{ width: "100%", height: "100%" }}
          >
            <color attach="background" args={["#ffffff"]} />
            <ambientLight intensity={0.5} />
            <PanControls enabled={interactionMode === "pan"} />

            <Scene
              strokes={[...strokes, ...temporaryStrokes]}
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
        </div>

        {loading && (
          <div
            data-testid="loading-overlay"
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
        {storageStatus.migrationWarning && (
          <div className="workspace-warning-overlay" data-testid="storage-migration-warning" role="status">
            {storageStatus.migrationWarning}
          </div>
        )}
        {operationNotice && (
          <div className="workspace-warning-overlay" data-testid="storage-operation-notice" role="status">
            {operationNotice}
          </div>
        )}
        {storageStatus.error && (
          <div className="workspace-warning-overlay" data-testid="storage-error" role="alert">
            {storageStatus.error}
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

function StatusFooter({ storageStatus }: { storageStatus: StorageStatus }) {
  const storageLabel = storageStatus.opfs ? "OPFS" : "メモリ";
  const engineLabel = storageStatus.store === "spatial" ? "Spatial" : "JSON fallback";
  const persistenceLabel = storageStatus.opfs ? "永続ストレージ" : "一時ストレージ";
  return (
    <footer data-testid="status-footer" style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "right" }}>
      <span data-testid="storage-status" style={{ color: storageStatus.opfs ? "#16a34a" : "#b45309", marginRight: 8 }}>
        {persistenceLabel}: {storageLabel} / {engineLabel}
      </span>
      Draw モード: クリックで点を追加・Escまたはダブルクリックで確定 | Measure モード: 長さ・面積・周長を表示 | Edit
      モード: 点をドラッグで移動 | Pan モード: ドラッグで移動・ホイールでズーム | Undo・Clear はヘッダーから
    </footer>
  );
}

export default function App() {
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("draw");
  const [strokeColor, setStrokeColor] = useState("#222222");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [simplifyOn, setSimplifyOn] = useState(true);
  const {
    canExport,
    features,
    handleClear,
    handleExportGeoJSON,
    handleImportGeoJSON,
    handleRefresh,
    handleUndo,
    loading,
    layers,
    operationNotice,
    promoteQueryResult,
    persistStroke,
    storageStatus,
    strokes,
    updateStroke,
  } = useGeometryFeatures(strokeColor, strokeWidth, simplifyOn);
  const query = useQueryWorkbench(features, layers, loading);

  return (
    <div
      data-testid="app-shell"
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
        exportDisabled={!canExport}
        handleImportGeoJSON={handleImportGeoJSON}
      />

      <div className="workbench-layout">
        <Workspace
          interactionMode={interactionMode}
          loading={loading}
          operationNotice={operationNotice}
          storageStatus={storageStatus}
          strokeColor={strokeColor}
          strokeWidth={strokeWidth}
          strokes={strokes}
          temporaryStrokes={query.temporaryStrokes}
          onFinishStroke={persistStroke}
          onUpdateStroke={updateStroke}
        />
        <SqlWorkbench
          query={query}
          onPromote={(layerName) =>
            query.result ? promoteQueryResult(query.result, layerName) : Promise.resolve({ status: "empty" as const })
          }
        />
      </div>

      <StatusFooter storageStatus={storageStatus} />
    </div>
  );
}

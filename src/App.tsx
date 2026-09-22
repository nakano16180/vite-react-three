import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Header } from "./components/Header";
import { Scene } from "./components/Scene";
import { DrawingSurface } from "./components/DrawingSurface";
import { StrokeEditor } from "./components/StrokeEditor";
import { PanControls } from "./components/PanControls";
import { SqlWorkbench } from "./components/SqlWorkbench";
import { LayerPanel } from "./components/LayerPanel";
import { AttributeTable } from "./components/AttributeTable";
import type { RenderableStroke } from "./domain/renderableStroke";
import { useGeometryFeatures, type StorageStatus } from "./hooks/useGeometryFeatures";
import type { Point2D } from "./domain/geometryFeature";
import { useQueryWorkbench } from "./hooks/useQueryWorkbench";
import { drawingRenderRank } from "./lib/renderOrder";
import { describeSelection, reconcileSelection, toggleSelection, type SelectionIdentity } from "./lib/selection";

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
  drawingRank: number;
  onFinishStroke: ReturnType<typeof useGeometryFeatures>["persistStroke"];
  onUpdateStroke: (strokeId: string, newPtsPx: Point2D[]) => Promise<void>;
  selection: SelectionIdentity[];
  selectable: boolean;
  onSelect: (identity: SelectionIdentity, additive: boolean) => void;
  onClearSelection: () => void;
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
  drawingRank,
  onFinishStroke,
  onUpdateStroke,
  selection,
  selectable,
  onSelect,
  onClearSelection,
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
              selection={selection}
            />
            <StrokeEditor strokes={strokes} onUpdateStroke={onUpdateStroke} enabled={interactionMode === "edit"} />
            <DrawingSurface
              onFinish={onFinishStroke}
              color={strokeColor}
              width={strokeWidth}
              enabled={interactionMode === "draw"}
              drawingRank={drawingRank}
              selection={selection}
              onCanvasClick={selectable ? onClearSelection : undefined}
              selectableStrokes={selectable ? [...strokes, ...temporaryStrokes] : undefined}
              onSelectStroke={
                selectable
                  ? (stroke, additive) =>
                      onSelect(stroke.selectionIdentity ?? { kind: "persistent", featureId: stroke.id }, additive)
                  : undefined
              }
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

function SelectionStatus({ selection }: { selection: SelectionIdentity[] }) {
  return (
    <div data-testid="selection-status" role="status" aria-live="polite">
      選択: {selection.length}件{selection.length > 0 && ` (${selection.map(describeSelection).join(", ")})`}
    </div>
  );
}

function StatusFooter({ storageStatus, selection }: { storageStatus: StorageStatus; selection: SelectionIdentity[] }) {
  const storageLabel = storageStatus.opfs ? "OPFS" : "メモリ";
  const engineLabel = storageStatus.store === "spatial" ? "Spatial" : "JSON fallback";
  const persistenceLabel = storageStatus.opfs ? "永続ストレージ" : "一時ストレージ";
  return (
    <footer data-testid="status-footer" style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "right" }}>
      <SelectionStatus selection={selection} />
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
    activeLayerId,
    canExport,
    deleteLayer,
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
    renameLayer,
    reorderLayers,
    setActiveLayer,
    setLayerVisibility,
    persistStroke,
    storageStatus,
    strokes,
    updateStroke,
    updateFeatureProperties,
  } = useGeometryFeatures(strokeColor, strokeWidth, simplifyOn);
  const query = useQueryWorkbench(features, layers, loading);
  const [selection, setSelection] = useState<SelectionIdentity[]>([]);
  const persistentFeatureIds = useMemo(() => new Set(features.map(({ id }) => id)), [features]);
  const activeLayer = layers.find(({ id }) => id === activeLayerId);

  useEffect(() => {
    setSelection((current) => reconcileSelection(current, persistentFeatureIds, query.selectionKeys));
  }, [persistentFeatureIds, query.selectionKeys]);

  const onSelect = useCallback((identity: SelectionIdentity, additive: boolean) => {
    setSelection((current) => toggleSelection(current, identity, additive));
  }, []);
  const onClearSelection = useCallback(() => setSelection([]), []);
  const selectable = interactionMode === "measure";

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
        <LayerPanel
          layers={layers}
          features={features}
          activeLayerId={activeLayerId}
          disabled={loading}
          onSetActive={setActiveLayer}
          onSetVisibility={setLayerVisibility}
          onRename={renameLayer}
          onReorder={reorderLayers}
          onDelete={deleteLayer}
        />
        <div className="workspace-column">
          <Workspace
            interactionMode={interactionMode}
            loading={loading}
            operationNotice={operationNotice}
            storageStatus={storageStatus}
            strokeColor={strokeColor}
            strokeWidth={strokeWidth}
            strokes={strokes}
            temporaryStrokes={query.temporaryStrokes}
            drawingRank={drawingRenderRank(layers.length)}
            onFinishStroke={persistStroke}
            onUpdateStroke={updateStroke}
            selection={selection}
            selectable={selectable}
            onSelect={onSelect}
            onClearSelection={onClearSelection}
          />
          <AttributeTable
            features={features}
            activeLayer={activeLayer}
            disabled={loading}
            onUpdateProperties={updateFeatureProperties}
          />
        </div>
        <SqlWorkbench
          query={query}
          selection={selection}
          selectable={selectable}
          onSelect={onSelect}
          onPromote={(layerName) =>
            query.result ? promoteQueryResult(query.result, layerName) : Promise.resolve({ status: "empty" as const })
          }
        />
      </div>

      <StatusFooter storageStatus={storageStatus} selection={selection} />
    </div>
  );
}

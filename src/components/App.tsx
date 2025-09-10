import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useDuckDB } from "../hooks/useDuckDB";
import { Header } from "./ui/Header";
import { Scene } from "./scene/Scene";
import { DrawingSurface } from "./scene/DrawingSurface";
import type { InteractionMode } from "../types";

export default function App() {
  const {
    loading,
    spatialLoaded,
    strokes,
    handleUndo,
    handleClear,
    handleRefresh,
    persistStroke,
  } = useDuckDB();

  const [pcdFileContents, setPcdFileContents] = useState<string[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('draw');
  const [strokeColor, setStrokeColor] = useState("#222222");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [simplifyOn, setSimplifyOn] = useState(true);

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
        setPcdFileContents(prev => [...prev, content]);
      }
    };
    reader.readAsText(file);
    
    // Reset the input so the same file can be loaded again
    event.target.value = '';
  };

  const handleClearPointClouds = () => {
    setPcdFileContents([]);
  };

  const handlePersistStroke = async (ptsPx: [number, number][]) => {
    await persistStroke(ptsPx, strokeColor, strokeWidth, simplifyOn);
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f5f5f5" }}>
      <Header
        interactionMode={interactionMode}
        setInteractionMode={setInteractionMode}
        strokeColor={strokeColor}
        setStrokeColor={setStrokeColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        simplifyOn={simplifyOn}
        setSimplifyOn={setSimplifyOn}
        onUndo={handleUndo}
        onRefresh={handleRefresh}
        onClear={handleClear}
        onFileLoad={handleFileLoad}
        pcdFileContents={pcdFileContents}
        onClearPointClouds={handleClearPointClouds}
      />

      <main style={{ flex: 1, padding: 12, minHeight: 0 }}>
        {/* 親は高さを持つだけ。装飾は持たせない */}
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {/* Canvas は absolute で inset:0（%高さ連鎖を断つ） */}
          <div style={{ position: "absolute", inset: 0 }}>
            <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 1 }} style={{ width: "100%", height: "100%" }}>
              <color attach="background" args={["#ffffff"]} />
              <ambientLight intensity={0.5} />
              {/* 画面操作 - OrbitControls behavior changes based on interaction mode */}
              <OrbitControls 
                makeDefault 
                enableRotate={false} 
                enabled={interactionMode === 'pan'}
              />

              <Scene pcdFileContents={pcdFileContents} strokes={strokes} />
              <DrawingSurface 
                onFinish={handlePersistStroke} 
                color={strokeColor} 
                width={strokeWidth} 
                enabled={interactionMode === 'draw'}
              />
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

      <footer style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "right" }}>
        Draw モード: 左ドラッグで描画 | Pan モード: ドラッグで移動・ホイールでズーム | PCDファイル読み込み対応 | Undo・Clear はヘッダーから
      </footer>
    </div>
  );
}
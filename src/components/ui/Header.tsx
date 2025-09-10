import type { InteractionMode } from "../../types";

interface HeaderProps {
  interactionMode: InteractionMode;
  setInteractionMode: (mode: InteractionMode) => void;
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  simplifyOn: boolean;
  setSimplifyOn: (simplify: boolean) => void;
  onUndo: () => void;
  onRefresh: () => void;
  onClear: () => void;
  onFileLoad: (event: React.ChangeEvent<HTMLInputElement>) => void;
  pcdFileContents: string[];
  onClearPointClouds: () => void;
}

export function Header({
  interactionMode,
  setInteractionMode,
  strokeColor,
  setStrokeColor,
  strokeWidth,
  setStrokeWidth,
  simplifyOn,
  setSimplifyOn,
  onUndo,
  onRefresh,
  onClear,
  onFileLoad,
  pcdFileContents,
  onClearPointClouds,
}: HeaderProps) {
  return (
    <header style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #e5e5e5", background: "#fff" }}>
      <h1 style={{ fontSize: 16, fontWeight: 600 }}>DuckDB Spatial × R3F — Line Draw & PCD Viewer</h1>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {/* Mode Toggle */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginRight: 16, borderRight: "1px solid #e5e5e5", paddingRight: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Mode:</span>
          <button 
            onClick={() => setInteractionMode('draw')}
            style={{ 
              padding: "4px 8px", 
              fontSize: 12, 
              backgroundColor: interactionMode === 'draw' ? "#007bff" : "#f8f9fa", 
              color: interactionMode === 'draw' ? "white" : "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              cursor: "pointer"
            }}
          >
            Draw
          </button>
          <button 
            onClick={() => setInteractionMode('pan')}
            style={{ 
              padding: "4px 8px", 
              fontSize: 12, 
              backgroundColor: interactionMode === 'pan' ? "#007bff" : "#f8f9fa", 
              color: interactionMode === 'pan' ? "white" : "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              cursor: "pointer"
            }}
          >
            Pan
          </button>
        </div>
        
        <label style={{ fontSize: 12 }}>色</label>
        <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} style={{ height: 32, width: 40 }} />
        <label style={{ fontSize: 12, marginLeft: 8 }}>太さ</label>
        <input type="range" min={1} max={24} value={strokeWidth} onChange={(e) => setStrokeWidth(parseInt(e.target.value))} />
        <label style={{ fontSize: 12, marginLeft: 8, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={simplifyOn} onChange={(e) => setSimplifyOn(e.target.checked)} /> Simplify
        </label>
        <button onClick={onUndo}>Undo</button>
        <button onClick={onRefresh}>Refresh</button>
        <button onClick={onClear} style={{ color: "#c00" }}>Clear</button>
        
        {/* PCD File Loading */}
        <div style={{ marginLeft: 16, borderLeft: "1px solid #e5e5e5", paddingLeft: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="pcd-file-input" style={{ cursor: "pointer", padding: "4px 8px", backgroundColor: "#007bff", color: "white", borderRadius: 4, fontSize: 12 }}>
            Load PCD File
          </label>
          <input 
            id="pcd-file-input"
            type="file" 
            accept=".pcd"
            onChange={onFileLoad} 
            style={{ display: "none" }}
          />
          {pcdFileContents.length > 0 && (
            <>
              <span style={{ fontSize: 12, color: "#666" }}>
                {pcdFileContents.length} cloud{pcdFileContents.length > 1 ? 's' : ''} loaded
              </span>
              <button onClick={onClearPointClouds} style={{ color: "#c00", fontSize: 12 }}>Clear Clouds</button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
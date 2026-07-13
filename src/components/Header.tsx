import React from "react";

type InteractionMode = "draw" | "pan" | "edit" | "measure";

interface HeaderProps {
  interactionMode: InteractionMode;
  setInteractionMode: (mode: InteractionMode) => void;
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  simplifyOn: boolean;
  setSimplifyOn: (on: boolean) => void;
  handleUndo: () => void;
  handleRefresh: () => void;
  handleClear: () => void;
  handleExportGeoJSON: () => void;
  handleImportGeoJSON: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleFileLoad: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleClearPointClouds: () => void;
  pcdFileContents: string[];
  showMap: boolean;
  setShowMap: (show: boolean) => void;
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
  handleUndo,
  handleRefresh,
  handleClear,
  handleExportGeoJSON,
  handleImportGeoJSON,
  handleFileLoad,
  handleClearPointClouds,
  pcdFileContents,
  showMap,
  setShowMap,
}: HeaderProps) {
  return (
    <header
      data-testid="app-header"
      style={{
        padding: 12,
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        borderBottom: "1px solid #e5e5e5",
        background: "#fff",
      }}
    >
      <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: "1 1 220px" }}>
        DuckDB Spatial × R3F — Line Draw & PCD Viewer
      </h1>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "flex-end",
          flex: "999 1 520px",
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        {/* Mode Toggle */}
        <div
          data-testid="mode-controls"
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            flexWrap: "wrap",
            marginRight: 16,
            borderRight: "1px solid #e5e5e5",
            paddingRight: 16,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>Mode:</span>
          <button
            aria-pressed={interactionMode === "draw"}
            onClick={() => setInteractionMode("draw")}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              backgroundColor: interactionMode === "draw" ? "#007bff" : "#f8f9fa",
              color: interactionMode === "draw" ? "white" : "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Draw
          </button>
          <button
            aria-pressed={interactionMode === "pan"}
            onClick={() => setInteractionMode("pan")}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              backgroundColor: interactionMode === "pan" ? "#007bff" : "#f8f9fa",
              color: interactionMode === "pan" ? "white" : "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Pan
          </button>
          <button
            aria-pressed={interactionMode === "edit"}
            onClick={() => setInteractionMode("edit")}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              backgroundColor: interactionMode === "edit" ? "#6f42c1" : "#f8f9fa",
              color: interactionMode === "edit" ? "white" : "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Edit
          </button>
          <button
            aria-pressed={interactionMode === "measure"}
            onClick={() => setInteractionMode("measure")}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              backgroundColor: interactionMode === "measure" ? "#0f766e" : "#f8f9fa",
              color: interactionMode === "measure" ? "white" : "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Measure
          </button>
        </div>

        {/* Map Toggle */}
        <div
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            marginRight: 16,
            borderRight: "1px solid #e5e5e5",
            paddingRight: 16,
          }}
        >
          <button
            aria-pressed={showMap}
            onClick={() => setShowMap(!showMap)}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              backgroundColor: showMap ? "#28a745" : "#f8f9fa",
              color: showMap ? "white" : "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {showMap ? "Hide Map" : "Show Map"}
          </button>
        </div>

        <label style={{ fontSize: 12 }}>色</label>
        <input
          type="color"
          value={strokeColor}
          onChange={(e) => setStrokeColor(e.target.value)}
          style={{ height: 32, width: 40 }}
        />
        <label style={{ fontSize: 12, marginLeft: 8 }}>太さ</label>
        <input
          type="range"
          min={1}
          max={24}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
        />
        <label
          style={{
            fontSize: 12,
            marginLeft: 8,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <input type="checkbox" checked={simplifyOn} onChange={(e) => setSimplifyOn(e.target.checked)} /> Simplify
        </label>
        <button onClick={handleUndo}>Undo</button>
        <button onClick={handleRefresh}>Refresh</button>
        <button onClick={handleClear} style={{ color: "#c00" }}>
          Clear
        </button>

        {/* GeoJSON Import / Export */}
        <div
          style={{
            marginLeft: 16,
            borderLeft: "1px solid #e5e5e5",
            paddingLeft: 16,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button onClick={handleExportGeoJSON} style={{ fontSize: 12 }}>
            Export GeoJSON
          </button>
          <label
            htmlFor="geojson-file-input"
            style={{
              cursor: "pointer",
              padding: "4px 8px",
              backgroundColor: "#f8f9fa",
              color: "#212529",
              border: "1px solid #dee2e6",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Import GeoJSON
          </label>
          <input
            id="geojson-file-input"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={handleImportGeoJSON}
            style={{ display: "none" }}
          />
        </div>

        {/* PCD File Loading */}
        <div
          style={{
            marginLeft: 16,
            borderLeft: "1px solid #e5e5e5",
            paddingLeft: 16,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label
            htmlFor="pcd-file-input"
            style={{
              cursor: "pointer",
              padding: "4px 8px",
              backgroundColor: "#007bff",
              color: "white",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Load PCD File
          </label>
          <input id="pcd-file-input" type="file" accept=".pcd" onChange={handleFileLoad} style={{ display: "none" }} />
          {pcdFileContents.length > 0 && (
            <>
              <span style={{ fontSize: 12, color: "#666" }}>
                {pcdFileContents.length} cloud
                {pcdFileContents.length > 1 ? "s" : ""} loaded
              </span>
              <button onClick={handleClearPointClouds} style={{ color: "#c00", fontSize: 12 }}>
                Clear Clouds
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

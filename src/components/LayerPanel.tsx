import { useState } from "react";
import { DEFAULT_LAYER_ID, type GeometryFeature, type Layer } from "../domain/geometryFeature";

interface LayerPanelProps {
  layers: Layer[];
  features: GeometryFeature[];
  activeLayerId: string;
  disabled: boolean;
  onSetActive: (layerId: string) => Promise<boolean>;
  onSetVisibility: (layerId: string, visible: boolean) => Promise<boolean>;
  onRename: (layerId: string, name: string) => Promise<boolean>;
  onReorder: (layerIds: string[]) => Promise<boolean>;
  onDelete: (layerId: string) => Promise<boolean>;
}

export function LayerPanel({
  layers,
  features,
  activeLayerId,
  disabled,
  onSetActive,
  onSetVisibility,
  onRename,
  onReorder,
  onDelete,
}: LayerPanelProps) {
  const [editingId, setEditingId] = useState<string>();
  const [draftName, setDraftName] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const controlsDisabled = disabled || actionPending;
  const counts = new Map<string, number>();
  for (const feature of features) counts.set(feature.layerId, (counts.get(feature.layerId) ?? 0) + 1);

  const runLayerAction = async (action: () => Promise<boolean>) => {
    if (controlsDisabled) return false;
    setActionPending(true);
    try {
      return await action();
    } finally {
      setActionPending(false);
    }
  };

  const move = (index: number, offset: -1 | 1) => {
    const next = [...layers];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void runLayerAction(() => onReorder(next.map(({ id }) => id)));
  };

  return (
    <aside className="layer-panel" aria-label="Layers">
      <h2>Layers</h2>
      <p className="layer-panel__hint">Active layer receives new drawings.</p>
      <ol className="layer-list">
        {layers.map((layer, index) => {
          const count = counts.get(layer.id) ?? 0;
          const editing = editingId === layer.id;
          return (
            <li key={layer.id} className="layer-item" data-active={layer.id === activeLayerId}>
              <div className="layer-item__main">
                <input
                  type="radio"
                  name="active-layer"
                  aria-label={`Set ${layer.name} as active layer`}
                  checked={layer.id === activeLayerId}
                  disabled={controlsDisabled}
                  onChange={() => void runLayerAction(() => onSetActive(layer.id))}
                />
                <input
                  type="checkbox"
                  aria-label={`Show ${layer.name}`}
                  checked={layer.visible}
                  disabled={controlsDisabled || layer.id === activeLayerId}
                  onChange={(event) => void runLayerAction(() => onSetVisibility(layer.id, event.target.checked))}
                />
                {editing ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = draftName.trim();
                      if (!name) return;
                      void runLayerAction(() => onRename(layer.id, name)).then((saved) => {
                        if (saved) setEditingId(undefined);
                      });
                    }}
                  >
                    <input
                      aria-label="Layer name"
                      value={draftName}
                      autoFocus
                      disabled={controlsDisabled}
                      onChange={(event) => setDraftName(event.target.value)}
                    />
                  </form>
                ) : (
                  <button
                    className="layer-item__name"
                    disabled={controlsDisabled}
                    onClick={() => {
                      setEditingId(layer.id);
                      setDraftName(layer.name);
                    }}
                  >
                    {layer.name}
                  </button>
                )}
                <span className="layer-item__count">{count}</span>
              </div>
              <div className="layer-item__actions">
                <button
                  aria-label={`Move ${layer.name} up`}
                  disabled={controlsDisabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${layer.name} down`}
                  disabled={controlsDisabled || index === layers.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  disabled={controlsDisabled || layer.id === DEFAULT_LAYER_ID}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete layer “${layer.name}” and its ${count} feature${count === 1 ? "" : "s"}? This cannot be undone.`
                      )
                    ) {
                      void runLayerAction(() => onDelete(layer.id));
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

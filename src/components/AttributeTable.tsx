import { useEffect, useMemo, useState } from "react";
import type { GeometryFeature, JsonValue, Layer } from "../domain/geometryFeature";
import type { RepositoryActionStatus } from "../db/geometryRepository";
import { persistentSelection, selectionIdentityKey, type SelectionIdentity } from "../lib/selection";
import {
  attributeDisplayValue,
  attributeEditorValue,
  attributeKeys,
  attributePropertyColumnKey,
  attributePropertyLabel,
  filterAndSortFeatures,
  parseAttributeValue,
  propertyUpdateSucceeded,
  type AttributeSort,
} from "../lib/attributeTable";

interface AttributeTableProps {
  features: GeometryFeature[];
  activeLayer?: Layer;
  disabled: boolean;
  onUpdateProperties: (featureId: string, properties: Record<string, JsonValue>) => Promise<RepositoryActionStatus>;
  selection: SelectionIdentity[];
  selectable: boolean;
  onSelect: (identity: SelectionIdentity, additive: boolean) => void;
}

interface EditingCell {
  featureId: string;
  key: string;
  draft: string;
  error?: string;
}

export function AttributeTable({
  features,
  activeLayer,
  disabled,
  onUpdateProperties,
  selection,
  selectable,
  onSelect,
}: AttributeTableProps) {
  const activeFeatures = useMemo(
    () => features.filter((feature) => feature.layerId === activeLayer?.id),
    [activeLayer?.id, features]
  );
  const keys = useMemo(() => attributeKeys(activeFeatures), [activeFeatures]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<AttributeSort>();
  const [editing, setEditing] = useState<EditingCell>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setFilters({});
    setSort(undefined);
    setEditing(undefined);
  }, [activeLayer?.id]);
  useEffect(() => {
    if (!editing) return;
    const feature = activeFeatures.find((candidate) => candidate.id === editing.featureId);
    if (!feature || !Object.prototype.hasOwnProperty.call(feature.properties, editing.key)) {
      setEditing(undefined);
    }
  }, [activeFeatures, editing]);
  const visibleFeatures = useMemo(
    () => filterAndSortFeatures(activeFeatures, filters, sort),
    [activeFeatures, filters, sort]
  );
  const selectedKeys = useMemo(() => new Set(selection.map(selectionIdentityKey)), [selection]);

  const changeSort = (key: string) =>
    setSort((current) =>
      current?.key === key && current.direction === "ascending"
        ? { key, direction: "descending" }
        : { key, direction: "ascending" }
    );

  const save = async (feature: GeometryFeature, key: string, draft: string) => {
    let value: JsonValue;
    try {
      value = parseAttributeValue(draft);
    } catch (error) {
      setEditing((current) =>
        current ? { ...current, error: error instanceof Error ? error.message.trim() : String(error) } : current
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await onUpdateProperties(feature.id, { ...feature.properties, [key]: value });
      if (propertyUpdateSucceeded(saved)) setEditing(undefined);
      else {
        setEditing((current) =>
          current ? { ...current, error: "Save failed. The stored value was not changed." } : current
        );
      }
    } catch (error) {
      setEditing((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error.message : "Save failed. The stored value was not changed.",
            }
          : current
      );
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: "id", label: "Feature ID", propertyKey: undefined },
    ...keys.map((key) => ({
      key: attributePropertyColumnKey(key),
      label: attributePropertyLabel(key),
      propertyKey: key,
    })),
  ];
  return (
    <section className="attribute-table" aria-label="Attribute table" data-testid="attribute-table">
      <div className="attribute-table__heading">
        <div>
          <span className="attribute-table__eyebrow">ACTIVE LAYER</span>
          <h2>Attributes</h2>
        </div>
        <span data-testid="attribute-row-count">
          {visibleFeatures.length} / {activeFeatures.length} rows
        </span>
      </div>
      <p className="attribute-table__hint">
        {activeLayer ? `Layer: ${activeLayer.name}. ` : "No active layer. "}
        ID and canonical geometry, style, layer, and creation fields are read-only. Existing property values accept
        JSON.
      </p>
      {activeFeatures.length === 0 ? (
        <p className="attribute-table__empty">This layer has no features.</p>
      ) : (
        <div className="attribute-table__wrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} aria-sort={sort?.key === column.key ? sort.direction : "none"}>
                    <button type="button" onClick={() => changeSort(column.key)} aria-label={`Sort by ${column.label}`}>
                      {column.label}
                      {sort?.key === column.key ? (sort.direction === "ascending" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="attribute-table__filters">
                {columns.map((column) => (
                  <th key={column.key}>
                    <input
                      aria-label={`Filter ${column.label}`}
                      value={filters[column.key] ?? ""}
                      placeholder="Filter"
                      onChange={(event) => setFilters((current) => ({ ...current, [column.key]: event.target.value }))}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleFeatures.map((feature) => {
                const identity = persistentSelection(feature.id);
                const selected = selectedKeys.has(selectionIdentityKey(identity));
                return (
                  <tr
                    key={feature.id}
                    data-attribute-selection={identity.kind}
                    data-selected={selected ? "true" : undefined}
                    aria-selected={selected}
                    tabIndex={selectable && !disabled ? 0 : -1}
                    onClick={(event) => {
                      if (!selectable || disabled) return;
                      onSelect(identity, event.ctrlKey || event.metaKey);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === " ") && selectable && !disabled) {
                        event.preventDefault();
                        onSelect(identity, event.ctrlKey || event.metaKey);
                      }
                    }}
                  >
                    <th scope="row" title={feature.id}>
                      {feature.id}
                    </th>
                    {columns.slice(1).map((column) => {
                      const key = column.propertyKey as string;
                      const label = column.label;
                      const value = feature.properties[key];
                      const isEditing = editing?.featureId === feature.id && editing.key === key;
                      if (value === undefined)
                        return (
                          <td key={key} className="attribute-table__missing">
                            —
                          </td>
                        );
                      return (
                        <td key={key}>
                          {isEditing ? (
                            <form
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                              onSubmit={(event) => {
                                event.preventDefault();
                                void save(feature, key, editing.draft);
                              }}
                            >
                              <input
                                autoFocus
                                aria-label={`Edit ${label} for ${feature.id}`}
                                aria-invalid={editing.error ? true : undefined}
                                value={editing.draft}
                                disabled={saving}
                                onChange={(event) =>
                                  setEditing((current) =>
                                    current ? { ...current, draft: event.target.value, error: undefined } : current
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setEditing(undefined);
                                  }
                                }}
                              />
                              <div className="attribute-table__edit-actions">
                                <button type="submit" disabled={saving}>
                                  {saving ? "Saving…" : "Save"}
                                </button>
                                <button type="button" disabled={saving} onClick={() => setEditing(undefined)}>
                                  Cancel
                                </button>
                              </div>
                              {editing.error && <span role="alert">{editing.error}</span>}
                            </form>
                          ) : (
                            <button
                              type="button"
                              className="attribute-table__value"
                              disabled={disabled || saving}
                              title={`Edit ${label}`}
                              aria-label={`Edit ${label} for ${feature.id}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditing({ featureId: feature.id, key, draft: attributeEditorValue(value) });
                              }}
                            >
                              {attributeDisplayValue(value)}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

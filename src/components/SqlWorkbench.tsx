import { useState } from "react";
import { SQL_EXAMPLES, type useQueryWorkbench } from "../hooks/useQueryWorkbench";
import type { QueryPromotionResult } from "../hooks/useGeometryFeatures";

const displayValue = (value: unknown) =>
  value === null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);

export function SqlWorkbench({
  query,
  onPromote,
}: {
  query: ReturnType<typeof useQueryWorkbench>;
  onPromote: (layerName: string) => Promise<QueryPromotionResult>;
}) {
  const renderedRowIndexes = new Set(query.temporaryStrokes.map(({ id }) => Number(id.replace("query-result-", ""))));
  const [layerName, setLayerName] = useState("Query result");
  const [promotionMessage, setPromotionMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  const promote = async () => {
    setSaving(true);
    setPromotionMessage(undefined);
    const promotion = await onPromote(layerName);
    setSaving(false);
    if (promotion.status === "saved") {
      setPromotionMessage(`Saved ${promotion.count} features to “${promotion.layerName}”.`);
    } else if (promotion.status === "invalid-name") {
      setPromotionMessage("Enter a layer name.");
    } else if (promotion.status === "empty") {
      setPromotionMessage("No supported result geometry is available to save.");
    } else {
      setPromotionMessage("Save failed. No partial layer was kept.");
    }
  };

  return (
    <aside className="sql-workbench" data-testid="sql-workbench">
      <div className="sql-workbench__heading">
        <div>
          <span className="sql-workbench__eyebrow">DUCKDB SPATIAL LAB</span>
          <h2>SQL Workbench</h2>
        </div>
        <span className={`query-status query-status--${query.status}`} role="status" data-testid="query-status">
          {query.status}
        </span>
      </div>

      <label className="sql-label" htmlFor="sql-editor">
        Read-only query
      </label>
      <textarea
        id="sql-editor"
        data-testid="sql-editor"
        value={query.sql}
        onChange={(event) => query.setSql(event.target.value)}
      />
      <div className="sql-actions">
        <button
          onClick={() => void query.execute()}
          disabled={query.status === "initializing" || query.status === "running"}
        >
          Run query
        </button>
        <button onClick={() => void query.cancel()} disabled={query.status !== "running"}>
          Cancel
        </button>
      </div>

      <label className="sql-label" htmlFor="sql-examples">
        Examples
      </label>
      <select
        id="sql-examples"
        defaultValue=""
        onChange={(event) => event.target.value && query.setSql(event.target.value)}
      >
        <option value="" disabled>
          Select an example
        </option>
        {SQL_EXAMPLES.map((example) => (
          <option key={example.label} value={example.sql}>
            {example.label}
          </option>
        ))}
      </select>

      <label className="sql-label" htmlFor="sql-history">
        Recent queries
      </label>
      <select id="sql-history" value="" onChange={(event) => event.target.value && query.setSql(event.target.value)}>
        <option value="">Select history</option>
        {query.history.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>

      {query.error && (
        <div className="query-message query-message--error" role="alert">
          {query.error}
        </div>
      )}
      {query.status === "cancelled" && <div className="query-message">Query cancelled.</div>}
      {query.status === "empty" && <div className="query-message">Query completed with no rows.</div>}
      {query.result && (
        <section className="query-results" aria-label="Query results">
          <div className="query-results__meta">
            <span>{query.result.rowCount} rows</span>
            <span>{query.result.truncated ? "Truncated at 1,000 rows" : "Complete result"}</span>
          </div>
          <div className="query-table-wrap">
            <table>
              <thead>
                <tr>
                  {query.result.columns.map((column) => (
                    <th key={column.name}>
                      {column.name}
                      <small>{column.type}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.result.rows.map((row, index) => (
                  <tr key={index} data-query-geometry={renderedRowIndexes.has(index) ? "rendered" : undefined}>
                    {query.result!.columns.map((column) => (
                      <td key={column.name}>{displayValue(row[column.name])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {query.temporaryStrokes.length > 0 && (
        <section className="query-promotion" aria-label="Save query result">
          <div className="query-message" data-testid="temporary-result-count">
            {query.temporaryStrokes.length} geometries rendered temporarily
          </div>
          <label className="sql-label" htmlFor="query-layer-name">
            Persistent layer name
          </label>
          <input
            id="query-layer-name"
            data-testid="query-layer-name"
            value={layerName}
            onChange={(event) => setLayerName(event.target.value)}
          />
          <button type="button" onClick={() => void promote()} disabled={saving || layerName.trim().length === 0}>
            {saving ? "Saving…" : "Save as layer"}
          </button>
          <small data-testid="query-promotion-duplicate-policy">
            Saving the same result again creates a new layer with new feature IDs; existing layers are not overwritten.
          </small>
        </section>
      )}
      {promotionMessage && (
        <div className="query-message" role="status" data-testid="query-promotion-status">
          {promotionMessage}
        </div>
      )}
    </aside>
  );
}

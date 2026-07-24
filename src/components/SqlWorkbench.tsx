import { SQL_EXAMPLES, useQueryWorkbench } from "../hooks/useQueryWorkbench";
import type { GeometryFeature, Layer } from "../domain/geometryFeature";

const displayValue = (value: unknown) =>
  value === null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);

export function SqlWorkbench({
  features,
  layers,
  storageLoading,
}: {
  features: GeometryFeature[];
  layers: Layer[];
  storageLoading: boolean;
}) {
  const query = useQueryWorkbench(features, layers, storageLoading);
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
                  <tr key={index}>
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
    </aside>
  );
}

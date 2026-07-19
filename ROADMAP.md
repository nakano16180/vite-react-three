# Roadmap

## Product Direction

This project is a browser-based geometry workbench that uses DuckDB and the
DuckDB spatial extension as its computation and query engine.

It does not aim to compete with tldraw or Excalidraw as a general-purpose
whiteboard. Drawing is the input method; the differentiator is being able to
store, inspect, transform, query, and export geometry with SQL in the browser.

## Guiding Principles

- Make DuckDB operations visible and understandable instead of hiding them
  behind drawing-only interactions.
- Treat every geometry as data with an ID, geometry type, attributes, and layer
  membership.
- Keep browser-local operation as the default. A backend should not be required
  for the core workflow.
- Add visual tools when they expose a useful spatial operation, not only because
  they are common in whiteboard software.
- Reintroduce map and point-cloud views only when they share the same layer,
  selection, query, and export model as other geometry.

## Phase 0: Stabilize the Geometry Core

Goal: establish a reliable base before expanding the product surface.

- [x] Define a canonical feature model for IDs, geometry, properties, style, and
      layer membership.
- [x] Separate geometry persistence and queries from React component state.
- [x] Make spatial-extension availability and JSON fallback behavior explicit
      in the UI.
- [x] Add unit tests for geometry calculations and integration tests for
      GeoJSON conversion and persistence.
- [x] Extend Playwright coverage for draw, edit, measure, pan, undo, clear,
      refresh, and GeoJSON import/export.

Exit criteria:

- Existing workflows survive reloads consistently.
- The same feature can round-trip through DuckDB and GeoJSON without losing its
  geometry type or properties.
- Core geometry and persistence tests run in CI.

## Phase 1: DuckDB Spatial Lab

Goal: make DuckDB the visible center of the application.

- Add a SQL editor with query execution, history, cancellation, and clear error
  messages.
- Expose documented read-only views for features and layers.
- Show tabular query results alongside the canvas.
- Render geometry returned by a query as a temporary result layer.
- Allow a result layer to be saved as a persistent layer.
- Include runnable examples for filtering, measuring, constructing, and
  converting geometry.

Exit criteria:

- A user can draw geometry, query it with SQL, see both rows and geometry
  results, and save or export the result without leaving the browser.

## Phase 2: Layers, Attributes, and Selection

Goal: turn independent strokes into a workable spatial dataset.

- Add a layer panel with visibility, ordering, rename, delete, and active-layer
  controls.
- Add feature selection from both the canvas and result table.
- Add an attribute table with sorting, filtering, and property editing.
- Synchronize selection between canvas, SQL results, and attribute table.
- Add per-layer style controls based on geometry type and attributes.
- Provide GeoJSON import mapping and per-layer export.

Exit criteria:

- Multiple datasets can be inspected and compared without losing track of their
  source, attributes, or selection state.

## Phase 3: Spatial Operations

Goal: provide practical geometry processing backed by DuckDB Spatial.

- Add buffer, simplify, centroid, envelope, intersection, union, difference,
  and spatial predicate tools.
- Generate tool forms from a small operation schema so SQL and UI tools share
  one implementation path.
- Show input layers, parameters, generated SQL, preview, and output destination
  for every operation.
- Keep operations non-destructive by default and write results to a new layer.
- Record operation provenance so a result can be reproduced.

Exit criteria:

- Common spatial transformations can be performed from either SQL or the UI,
  produce equivalent results, and remain reproducible.

## Phase 4: Coordinates and Map Context

Goal: support real-world spatial data after the layer model is established.

- Add coordinate reference system metadata and explicit pixel/world coordinate
  handling.
- Define import behavior for datasets with missing or unsupported CRS metadata.
- Add coordinate readout, scale-aware measurements, and viewport bounds.
- Reintroduce a map as a layer-backed basemap or geographic viewport, not as a
  separate application mode.
- Verify reprojection support available in DuckDB Spatial before exposing CRS
  conversion in the UI.

Exit criteria:

- Geographic data can be imported, measured, queried, displayed over a map, and
  exported without silently changing coordinates.

## Phase 5: Data Formats and Larger Datasets

Goal: demonstrate DuckDB's value beyond hand-drawn geometry.

- Add import and export support based on formats DuckDB Spatial can reliably
  handle in the browser.
- Add CSV ingestion with configurable longitude/latitude or WKT columns.
- Explore GeoParquet and FlatGeobuf for larger vector datasets.
- Add query-driven loading, bounding-box filtering, and geometry
  simplification for responsive rendering.
- Re-evaluate PCD support only after point clouds can participate in the common
  layer, metadata, visibility, and query model.

Exit criteria:

- A dataset larger than the interactive drawing use case can be loaded,
  filtered through DuckDB, and rendered without requiring all source geometry
  in React state.

## Later Opportunities

These are intentionally deferred until the spatial workbench is coherent:

- Shareable project files and deterministic session export.
- Reusable SQL notebooks or analysis recipes.
- Spatial joins and multi-step operation pipelines.
- Plugin APIs for custom importers, renderers, and operations.
- Collaboration features based on explicit demand.

General whiteboard features such as freehand illustration, rich text layout,
stickers, presentation mode, and real-time multiplayer are not priorities unless
they directly support a spatial-analysis workflow.

## Near-Term Milestones

1. [x] Complete the canonical feature and layer schema.
2. [x] Add automated tests around geometry persistence and GeoJSON round-trips.
3. [x] Complete Phase 0 browser workflow coverage.
4. [ ] Build the SQL editor and tabular result view.
5. [ ] Render query geometry as a temporary layer.
6. [ ] Promote query results to persistent layers.
7. [ ] Build the layer panel and synchronized selection.

The first major product milestone is complete when a user can draw or import
geometry, query it with DuckDB SQL, inspect the resulting rows and shapes, and
save or export the result entirely in the browser.

## Current Status

### Completed on 2026-07-18

- Added the canonical feature and layer model, including IDs, properties, style,
  layer membership, and deterministic insertion order.
- Moved DuckDB initialization, persistence, migration, and GeoJSON conversion
  out of React component state.
- Added sticky Spatial/JSON store selection and made OPFS, memory, Spatial, and
  JSON fallback status visible in the UI.
- Added Vitest coverage for geometry, the canonical model, GeoJSON, persistence,
  migration, operation ordering, and import/export.
- Added browser coverage for drawing, measurement, refresh/reload durability,
  undo, and GeoJSON round-trips.

The canonical persistence implementation was merged in PR #36. Phase 0 browser
workflow coverage was completed on 2026-07-19, including a fix that maps primary
pointer dragging to Pan instead of the disabled Rotate action.

## Today: 2026-07-19

Goal: finish the Phase 0 verification boundary, then prepare the first Phase 1
slice without mixing both concerns into one implementation change.

### Must do

- [x] Write a browser-workflow coverage matrix for draw, edit, measure, pan,
      undo, clear, refresh/reload, and GeoJSON import/export.
- [x] Add the missing high-value Playwright paths, especially edit persistence,
      pan interaction, and explicit clear persistence.
- [x] Keep stateful E2E deterministic: use serial execution, test-owned data,
      observable cleanup, and assertions tied to the geometry created by each
      test.
- [x] Run unit tests, Playwright, lint, and build; record any known environmental
      warnings separately from product failures.

Browser workflow coverage:

| Workflow              | Observable verification                                             |
| --------------------- | ------------------------------------------------------------------- |
| Draw and measure      | Draw a known line and assert its exact measurement                  |
| Edit                  | Drag a known endpoint and assert the changed exact measurement      |
| Pan                   | Assert the measurement label moves and feature count stays stable   |
| Undo                  | Assert the most recently inserted feature is removed                |
| Clear                 | Assert geometry stays absent after refresh and reload               |
| Refresh and reload    | Assert exact geometry survives both operations                      |
| GeoJSON import/export | Assert geometry type, properties, style, layer, and ID semantics    |
| Desktop and mobile    | Run the complete workflow suite in both deterministic viewport sets |

Verification completed on 2026-07-19:

- Vitest: 89 tests passed.
- Playwright: 20 tests passed across desktop and mobile.
- ESLint: passed.
- Production build: passed with the existing large-chunk warning.

### Next if the Phase 0 checks are green

- [ ] Draft the SQL editor and tabular result-view design.
- [ ] Put system invariants before the task list, including read-only query
      boundaries, result-size limits, cancellation behavior, and the rule that
      query results do not mutate persistent features implicitly.
- [ ] Add a failure matrix covering invalid SQL, long-running and cancelled
      queries, empty and large results, geometry/non-geometry columns,
      Spatial/JSON stores, and component unmount or database restart.
- [ ] Define the smallest vertical slice: execute read-only SQL against
      documented feature/layer views and display tabular results. Temporary
      geometry rendering remains the following milestone.

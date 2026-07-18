# DuckDB Spatial Geometry Workbench

A browser-based geometry drawing and measurement workbench built with Vite, React, TypeScript, React Three Fiber, and DuckDB WASM.

The app lets you draw lines and polygons on a 2D Three.js canvas, persist them in DuckDB, measure length/area/perimeter, edit saved points, and import or export GeoJSON.

## Features

- Draw mode: click points on the canvas, then press Escape or double-click to save.
- Polygon detection: close a shape by ending near the first point.
- Measure mode: displays line length or polygon area/perimeter.
- Edit mode: move saved stroke points.
- Pan mode: pan and zoom the orthographic canvas.
- A canonical `GeometryFeature` model keeps pixel-coordinate geometry, user properties, style, layer membership,
  and creation time independent of the active database table.
- Canonical geometry is either a `LineString` or a hole-free `Polygon`; polygon rings are stored open internally
  and closed only at serialization boundaries.
- New and legacy features belong to the built-in visible `Default` layer unless valid layer metadata specifies
  another layer.
- DuckDB WASM persistence uses OPFS when available and an in-memory database otherwise.
- DuckDB Spatial storage is used when available, with a JSON-table feature store as the non-Spatial fallback.
- Canonical GeoJSON import and export preserve user properties and workbench metadata for style, layer, creation
  time, and referenced layers.

## Requirements

- Node.js 22 or newer is recommended.
- npm

## Getting Started

Install dependencies:

```sh
npm install
```

Start the development server:

```sh
npm run dev
```

Build for production:

```sh
npm run build
```

Preview a production build:

```sh
npm run preview
```

## Scripts

- `npm run dev`: start Vite.
- `npm run build`: run TypeScript build checks and create a Vite production build.
- `npm run lint`: run ESLint.
- `npm run lint:fix`: run ESLint with automatic fixes.
- `npm run format`: format files with Prettier.
- `npm run format:check`: check Prettier formatting.
- `npm run test`: run the Vitest unit suite once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run test:e2e`: run the Playwright end-to-end suite.
- `npm run test:e2e:headed`: run Playwright with a visible browser.
- `npm run test:e2e:ui`: open the Playwright test UI.
- `npm run preview`: preview the production build.

## App Structure

- `src/App.tsx`: application layout and mode wiring.
- `src/domain/geometryFeature.ts`: canonical feature, geometry, style, and layer model.
- `src/domain/renderableStroke.ts`: conversion from canonical features to rendering and measurement data, including
  optional geometry simplification.
- `src/db/createDuckDB.ts`: DuckDB startup, capability detection, and active-store selection.
- `src/db/geometryRepository.ts`: store-independent feature and layer persistence, migration, and transactions.
- `src/hooks/useGeometryFeatures.ts`: React feature state and serialized repository operations.
- `src/components/Header.tsx`: toolbar controls.
- `src/components/DrawingSurface.tsx`: canvas drawing interactions.
- `src/components/Scene.tsx`: feature, measurement, and polygon rendering.
- `src/components/StrokeEditor.tsx`: point editing.
- `src/lib/geometry.ts`: length, area, perimeter, centroid, and polygon-closing measurement helpers.
- `src/lib/geojson.ts`: canonical GeoJSON import and export.
- `src/dbBundles.ts`: manually bundled DuckDB WASM assets.

## DuckDB Notes

Database location and feature storage are separate capabilities, producing four normal runtime combinations:

| Database | Active feature store | Behavior                                                                     |
| -------- | -------------------- | ---------------------------------------------------------------------------- |
| OPFS     | Spatial              | Durable database using the `features` table and DuckDB geometry values.      |
| OPFS     | JSON fallback        | Durable database using the `features_json` table and JSON coordinates.       |
| Memory   | Spatial              | Session-only database using the `features` table and DuckDB geometry values. |
| Memory   | JSON fallback        | Session-only database using the `features_json` table and JSON coordinates.  |

The app first attempts to open `opfs://vite-react-three.duckdb`; if OPFS is unavailable, DuckDB continues in
memory. It independently attempts to install and load the `spatial` extension.

On first initialization, the selected feature store is recorded as `active_feature_store` in `app_metadata`.
Subsequent sessions keep using that store so data does not silently split between the Spatial and JSON tables. If an
existing database requires the Spatial store but the extension cannot be loaded, initialization reports an error
instead of switching to JSON fallback.

The repository creates the `Default` layer and transactionally migrates legacy `strokes_json` and `strokes` rows
into canonical features once. Legacy colors and widths become canonical style, migrated features are assigned to
the `Default` layer, and a Spatial row takes precedence when both legacy tables contain the same ID. Migration
failures before commit are rolled back, surfaced as warnings, and retried on a later initialization. After a
successful commit, each legacy source has its own migration marker; a subsequent OPFS checkpoint failure is reported
as a durability warning without rerunning that source. If Spatial is unavailable while a legacy `strokes` table
exists, JSON legacy rows are committed and marked immediately while Spatial migration remains pending until the
extension becomes available. A later Spatial migration replaces a same-ID JSON legacy feature so Spatial precedence
is preserved across sessions.

Canonical `createdAt` records when a feature was originally created and survives GeoJSON round-trips. A separate
monotonic database insertion order determines Undo order, so importing an older feature does not cause Undo to delete
a newer pre-existing drawing and multi-feature imports undo in file order.

GeoJSON exports standard `LineString` or single-ring, hole-free `Polygon` geometry and preserves canonical user
properties in `properties`. During legacy import, the transport fields `id`, `color`, `width`, and `geomType` are
removed from `properties`; `color` and `width` are converted to canonical style when explicit workbench style is
absent. Polygons with holes or multiple rings are unsupported and skipped with an import warning.
Workbench-specific `style`, `layerId`, and `createdAt` values are stored in each feature's `workbench` member, while
referenced layer definitions are stored in the collection-level `workbench.layers`. Import accepts this metadata,
falls back to the `Default` layer and default/legacy style when needed, and skips unsupported features with warnings.

The Vite dev server sends cross-origin isolation headers required by some DuckDB WASM configurations:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

## Testing

For current validation, run:

```sh
npm run test
npm run test:e2e
npm run lint
npm run format:check
npm run build
```

Vitest covers the canonical domain model, geometry conversion, GeoJSON codec, persistence behavior, migration, and
operation queue. Playwright covers core application and GeoJSON workflows.

Playwright can test canvas drawing by using fixed pointer coordinates relative to the canvas bounding box. This app's drawing flow is click-based:

```ts
const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("canvas not found");

await page.mouse.click(box.x + 100, box.y + 100);
await page.mouse.click(box.x + 240, box.y + 100);
await page.mouse.click(box.x + 240, box.y + 180);
await page.keyboard.press("Escape");
```

For React Three Fiber/WebGL output, prefer canvas screenshots with a fixed viewport:

```ts
await expect(canvas).toHaveScreenshot("drawn-line.png");
```

Pixel reads through `getContext("2d")` are not reliable for WebGL canvas output, so screenshot comparisons or DOM-visible measurement labels are usually better assertions.

# DuckDB Spatial Geometry Workbench

A browser-based geometry drawing and measurement workbench built with Vite, React, TypeScript, React Three Fiber, and DuckDB WASM.

The app lets you draw lines and polygons on a 2D Three.js canvas, persist them in DuckDB, measure length/area/perimeter, edit saved points, and import or export GeoJSON.

## Features

- Draw mode: click points on the canvas, then press Escape or double-click to save.
- Polygon detection: close a shape by ending near the first point.
- Measure mode: displays line length or polygon area/perimeter.
- Edit mode: move saved stroke points.
- Pan mode: pan and zoom the orthographic canvas.
- DuckDB WASM persistence with OPFS when available.
- DuckDB spatial extension support with JSON-table fallback.
- GeoJSON import and export.

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
- `npm run preview`: preview the production build.

## App Structure

- `src/App.tsx`: app state, DuckDB initialization, persistence, and mode switching.
- `src/components/Header.tsx`: toolbar controls.
- `src/components/DrawingSurface.tsx`: canvas drawing interactions.
- `src/components/Scene.tsx`: stroke, measurement, and polygon rendering.
- `src/components/StrokeEditor.tsx`: point editing.
- `src/lib/geometry.ts`: geometry calculations.
- `src/dbBundles.ts`: manually bundled DuckDB WASM assets.

## DuckDB Notes

The app attempts to open an OPFS-backed DuckDB database at `opfs://vite-react-three.duckdb`. If OPFS is unavailable, it falls back to an in-memory database.

The app also attempts to install and load DuckDB's `spatial` extension. When the extension is unavailable, geometry is still stored in the JSON fallback table, but spatial-specific behavior may be limited.

The Vite dev server sends cross-origin isolation headers required by some DuckDB WASM configurations:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

## Testing

For current validation, run:

```sh
npm run lint
npm run build
```

Good next steps for automated coverage:

- Add unit tests for `src/lib/geometry.ts`.
- Add tests for geometry serialization and persistence behavior.
- Extend Playwright coverage for draw, edit, measure, pan, undo, clear, and GeoJSON workflows.

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

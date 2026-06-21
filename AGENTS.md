# Agent Guide

## Project Overview

This is a Vite + React + TypeScript app for drawing and measuring 2D geometry on a React Three Fiber canvas. It stores drawn strokes in DuckDB WASM, uses the DuckDB spatial extension when available, can display point clouds from PCD files, and can switch to a MapLibre map view.

Core files:

- `src/App.tsx`: application state, DuckDB setup, persistence, mode wiring.
- `src/components/DrawingSurface.tsx`: click-based line and polygon drawing on the R3F canvas.
- `src/components/Scene.tsx`: renders saved strokes, filled polygons, measurements, and PCD content.
- `src/components/StrokeEditor.tsx`: edit mode for dragging existing stroke points.
- `src/components/Header.tsx`: toolbar controls.
- `src/lib/geometry.ts`: pure geometry helpers for length, area, perimeter, centroid, and polygon closing.

## Development Commands

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Format: `npm run format`
- Check formatting: `npm run format:check`
- Preview production build: `npm run preview`

The Vite dev server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers because DuckDB WASM can require cross-origin isolation.

## Coding Notes

- Keep coordinate storage in pixel coordinates (`Point2D`) unless changing the persistence model intentionally.
- Preserve the fallback JSON table path for environments where the DuckDB spatial extension cannot load.
- Prefer extending `src/lib/geometry.ts` for pure geometry behavior and test those helpers directly when a test runner is added.
- Avoid unrelated UI refactors when changing drawing, measurement, persistence, or map behavior.
- When changing canvas interactions, verify draw, edit, measure, pan, undo, clear, refresh, and PCD loading paths as applicable.

## Testing Guidance

There is currently no committed automated test runner. For now, run at minimum:

```sh
npm run lint
npm run build
```

Recommended future test layers:

1. Unit tests for `src/lib/geometry.ts`.
2. Integration tests for WKT/GeoJSON conversion and persistence behavior.
3. Playwright end-to-end tests for toolbar modes and canvas drawing behavior.

For canvas drawing tests, Playwright can exercise deterministic pointer coordinates. Use the canvas bounding box as the coordinate origin, then click or drag relative to it. For this app, drawing is click-based: click points, then double-click or press Escape to finish.

Example Playwright flow:

```ts
const canvas = page.locator("canvas");
await expect(canvas).toBeVisible();

const box = await canvas.boundingBox();
if (!box) throw new Error("canvas not found");

await page.mouse.click(box.x + 100, box.y + 100);
await page.mouse.click(box.x + 240, box.y + 100);
await page.mouse.click(box.x + 240, box.y + 180);
await page.keyboard.press("Escape");
```

Validation options:

- Prefer element screenshots for WebGL/R3F output: `await expect(canvas).toHaveScreenshot("line.png")`.
- Use deterministic viewport sizes to reduce snapshot churn.
- Validate measurement labels in DOM when measure mode is active.
- For WebGL canvas, do not assume `getContext("2d").getImageData()` is available. Screenshot comparison is usually the practical path.
- If canvas output is flaky, add stable test IDs or DOM-accessible state summaries rather than relying only on pixel snapshots.

Before finishing a change that affects rendering, use Playwright screenshots when possible to confirm that the canvas is nonblank and that expected geometry appears in desktop and mobile viewport sizes.

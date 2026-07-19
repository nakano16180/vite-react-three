# Pan Coordinate Preservation Design

## Goal

Keep persisted `Point2D` values in model-space pixel coordinates and preserve
the panned viewport across reloads. Drawing and editing must remain available
over the visible canvas after the orthographic camera has been panned.

## Scope

- Persist and restore the orthographic camera position and controls target.
- Keep drawing and editing interaction planes aligned with the visible viewport.
- Add browser coverage for drawing and editing after Pan followed by reload.
- Do not change the persistence schema or configure touch gestures.

## Design

Treat persisted pixel coordinates as model coordinates. R3F pointer
intersections already produce world coordinates, so the existing pixel/world
conversion must not subtract the camera position.

Add a focused Pan controls component that restores camera position and controls
target from browser-local viewport state, then writes both values whenever the
controls change. Camera position and target move together, preserving the
orthographic viewing direction. Invalid or missing saved state falls back to
the current `[0, 0, 100]` camera and `[0, 0, 0]` target.

`DrawingSurface` and `StrokeEditor` will center their transparent interaction
planes on the current camera x/y position. Geometry and edit handles remain in
model space; only the event-capturing planes follow the visible viewport.

## Verification

Use test-driven development:

1. Add a Playwright regression that pans, draws, reloads, and verifies the
   measurement remains at the same rendered location.
2. Confirm the regression fails before adding the implementation.
3. Add viewport-state parsing tests and the smallest Pan controls integration.
4. Add browser coverage that the visible interaction plane still accepts
   drawing and editing after Pan.
5. Run unit tests, the focused browser tests, lint, and build.

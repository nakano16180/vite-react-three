# Pan Coordinate Preservation Design

## Goal

Keep persisted `Point2D` values in model-space pixel coordinates and preserve
the panned viewport across reloads. Drawing and editing must remain available
over the visible canvas after the orthographic camera has been panned.

## Scope

- Persist and restore the orthographic camera position and controls target.
- Persist and restore the orthographic camera zoom.
- Keep drawing and editing interaction planes aligned with the visible viewport.
- Add browser coverage for drawing and editing after Pan followed by reload.
- Do not change the persistence schema or configure touch gestures.

## Design

Treat persisted pixel coordinates as model coordinates. R3F pointer
intersections already produce world coordinates, so the existing pixel/world
conversion must not subtract the camera position.

Pointer NDC converts to model pixels around the canvas center. The pointer
offset from that center is divided by the orthographic camera zoom before the
camera Pan offset is applied. This keeps previews and persisted geometry under
the cursor at zoom levels below, equal to, or above `1`.

Add a focused Pan controls component that restores camera position, controls
target, and zoom from browser-local viewport state, then writes those values
whenever the controls change. Camera position and target move together,
preserving the orthographic viewing direction. Restoring zoom updates the
camera projection matrix. Invalid or missing saved state falls back to the
current `[0, 0, 100]` camera, `[0, 0, 0]` target, and zoom `1`. Saved state from
the earlier format without zoom remains valid and receives zoom `1`.

`DrawingSurface` will update its transparent interaction plane from `useFrame`
so camera restoration and control mutation do not depend on React rendering.
Geometry and previews remain in model space; only the event-capturing plane
follows the visible viewport.

## Verification

Use test-driven development:

1. Add a Playwright regression that pans, draws, reloads, and verifies the
   measurement remains at the same rendered location.
2. Confirm the regression fails before adding the implementation.
3. Add viewport-state parsing tests and the smallest Pan controls integration.
4. Add browser coverage that the visible interaction plane still accepts
   drawing immediately after viewport restoration without a mode change.
5. Add browser coverage that Pan and zoom both survive reload.
6. Add unit coverage for pointer conversion at zoom `0.5`, `1`, and `2`, and
   derive the browser-test measurement from screen distance divided by zoom.
7. Run unit tests, the focused browser tests, lint, and build.

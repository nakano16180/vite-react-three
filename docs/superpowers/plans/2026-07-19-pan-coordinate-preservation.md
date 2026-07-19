# Pan Coordinate Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Pan and zoom across reloads while keeping drawing available immediately after viewport restoration.

**Architecture:** Keep persisted `Point2D` values in model space. Store camera position, OrbitControls target, and orthographic zoom as browser-local viewport state; restore them together, and synchronize the transparent draw plane from the render loop rather than React render timing.

**Tech Stack:** React 19, React Three Fiber, Three.js orthographic camera, Vitest, Playwright

## Global Constraints

- Keep persisted coordinates as `Point2D` pixel coordinates.
- Do not change the persistence schema.
- Do not configure touch gestures.
- Preserve draw, edit, measure, pan, refresh, reload, and GeoJSON behavior.

---

### Task 0: Address viewport restoration review feedback

**Files:**

- Modify: `src/lib/viewportState.test.ts`
- Modify: `src/lib/viewportState.ts`
- Modify: `src/components/PanControls.tsx`
- Modify: `src/components/DrawingSurface.tsx`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**

- Extends `ViewportState` with `zoom: number`.
- Treats stored state without `zoom` as zoom `1`.
- Keeps the draw plane position synchronized with camera x/y on every frame.

- [ ] **Step 1: Write failing zoom state tests**

Add tests for valid positive zoom, legacy state without zoom, zero zoom, negative
zoom, non-finite zoom, and saving zoom.

- [ ] **Step 2: Verify the zoom tests fail**

Run:

```sh
npm test -- src/lib/viewportState.test.ts
```

Expected: FAIL because viewport state does not yet load or save zoom.

- [ ] **Step 3: Extend viewport state and PanControls**

Load legacy state with zoom `1`, reject explicitly invalid zoom, persist current
camera zoom, and restore zoom before calling `camera.updateProjectionMatrix()`
and `controls.update()`.

- [ ] **Step 4: Write a failing restored-Draw E2E**

After Pan and zoom, reload while Draw remains the default mode. Without changing
mode, draw a uniquely measurable line in the visible region and assert it is
persisted. Also verify the pre-existing measurement has the same bounding box
before and after reload.

- [ ] **Step 5: Verify the restored-Draw E2E fails**

Run:

```sh
npx playwright test tests/e2e/app.spec.ts --grep "PanとZoom"
```

Expected: FAIL before the draw plane frame synchronization and zoom restoration.

- [ ] **Step 6: Synchronize the draw plane**

Use a mesh ref and `useFrame` to copy camera x/y into the plane position. Keep
geometry, previews, and persisted model coordinates unchanged.

- [ ] **Step 7: Verify focused tests**

Run:

```sh
npm test -- src/lib/viewportState.test.ts
npx playwright test tests/e2e/app.spec.ts --grep "PanとZoom"
```

Expected: PASS on desktop and mobile.

### Task 1: Reproduce viewport loss after reload

**Files:**

- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**

- Consumes: the existing toolbar, canvas pointer interactions, GeoJSON export, and reload workflow.
- Produces: a regression test that proves a panned viewport and its rendered geometry survive reload.

- [ ] **Step 1: Write the failing regression test**

Add a focused Playwright test that clears storage, draws a known line, pans the
camera, records the measurement bounding box, reloads, enables Measure again,
and asserts the measurement bounding box remains within two pixels of the
pre-reload location.

- [ ] **Step 2: Run the focused test**

Run:

```sh
npx playwright test tests/e2e/app.spec.ts --grep "Pan後の座標"
```

Expected: FAIL because reload resets the camera and the measurement returns to
its un-panned location.

- [ ] **Step 3: Inspect the R3F values at the failure boundary**

The failure distance must match the Pan displacement while exported geometry
coordinates remain unchanged, proving viewport loss rather than coordinate
corruption.

### Task 2: Persist and restore viewport state

**Files:**

- Create: `src/lib/viewportState.ts`
- Create: `src/lib/viewportState.test.ts`
- Create: `src/components/PanControls.tsx`
- Modify: `src/App.tsx`

**Interfaces:**

- Produces: validated load/save functions for camera position and controls
  target, plus a Pan controls component that applies them.
- Consumes: browser `localStorage`, R3F camera, and Drei `OrbitControls`.

- [ ] **Step 1: Write failing unit tests**

Cover missing, malformed, non-finite, and valid viewport-state JSON. Valid state
contains finite `cameraX`, `cameraY`, `targetX`, and `targetY` numbers.

- [ ] **Step 2: Verify the unit tests fail**

Run:

```sh
npm test -- src/lib/viewportState.test.ts
```

Expected: FAIL because the viewport-state module does not exist.

- [ ] **Step 3: Implement the smallest pure helper**

Implement validated browser-local load/save helpers with a stable storage key.
Storage failures must fall back silently because viewport persistence is not
allowed to block geometry work.

- [ ] **Step 4: Integrate the helper**

Create `PanControls` to restore camera and target together and save them from
the controls change callback. Replace the inline `OrbitControls` in `App.tsx`.

- [ ] **Step 5: Verify unit and focused browser tests**

Run:

```sh
npm test -- src/lib/viewportState.test.ts
npx playwright test tests/e2e/app.spec.ts --grep "Pan後の座標"
```

Expected: PASS.

### Task 3: Keep interaction planes in the visible viewport

**Files:**

- Modify: `src/components/DrawingSurface.tsx`
- Modify: `src/components/StrokeEditor.tsx`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**

- Consumes: current R3F camera x/y position.
- Produces: camera-centered transparent planes without changing model-space geometry.

- [ ] **Step 1: Extend the failing browser regression**

After Pan, switch to Draw and create a line near the visible canvas edges.
Then switch to Edit and drag an endpoint. Assert both operations persist and
remain visible after reload.

- [ ] **Step 2: Verify the extended regression fails**

Run the focused Playwright test and confirm the large Pan leaves at least one
pointer location outside the existing origin-centered plane.

- [ ] **Step 3: Center interaction planes on the camera**

Read `camera` from `useThree()` and set each transparent plane position to
`[camera.position.x, camera.position.y, z]`. Do not offset rendered strokes,
handles, previews, or persisted coordinates.

- [ ] **Step 4: Verify the focused regression passes**

Run the focused Playwright test for desktop and mobile and expect both to pass.

### Task 4: Regression verification

**Files:**

- Modify only files needed to correct formatting or type errors introduced above.

**Interfaces:**

- Consumes: completed regression and implementation.
- Produces: repository-wide verification evidence.

- [ ] **Step 1: Run the full unit suite**

```sh
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run the full browser suite**

```sh
npm run test:e2e
```

Expected: all desktop and mobile projects pass.

- [ ] **Step 3: Run static checks**

```sh
npm run lint
npm run build
npm run format:check
git diff --check
```

Expected: all commands pass; existing Vite chunk-size and DuckDB sourcemap
warnings may remain.

- [ ] **Step 4: Review scope**

Confirm the diff does not configure `touches.ONE`, alter persistence, or include
unrelated UI refactors.

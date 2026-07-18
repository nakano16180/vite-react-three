# Canonical Feature と永続化の実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ID、geometry、properties、style、layer membershipを持つcanonical feature modelを導入し、DuckDB Spatial / JSON fallbackで永続化してGeoJSONを損失なく往復できるようにする。

**Architecture:** ReactやDuckDBに依存しないdomain modelとGeoJSON codecを作り、DuckDB接続・schema・migration・CRUDをrepositoryへ隔離する。React hookはrepository lifecycleとUI stateだけを担当し、既存canvasには互換性のある表示用strokeを渡す。

**Tech Stack:** React 19、TypeScript 5.8、Vite 7、DuckDB WASM、DuckDB Spatial、Vitest、Playwright

## Global Constraints

- coordinateは引き続きpixel coordinate（`Point2D`）で保存する。
- 対応geometryは `LineString` とholeなし `Polygon` のみとする。
- 現在のUIでは固定IDの `Default` レイヤーだけを使用する。
- Spatial storeとJSON fallback storeで同じcanonical feature動作を提供する。
- legacy `strokes` / `strokes_json` tableはmigration後も削除しない。
- drawing、editing、measurement、pan、undo、clear、refresh、GeoJSON import/exportの既存UIを維持する。
- `ROADMAP.md` はユーザーの未追跡ファイルなので、この計画のcommitには含めない。

---

## File Map

- Create `src/domain/geometryFeature.ts`: canonical型、default、validation、feature生成。
- Create `src/domain/geometryFeature.test.ts`: domain modelのunit test。
- Modify `src/lib/geometry.ts`: `Point2D` をdomainから再exportして既存importを維持。
- Create `src/lib/geometry.test.ts`: geometry helperのunit test。
- Create `src/lib/geojson.ts`: canonical modelとGeoJSONの相互変換。
- Create `src/lib/geojson.test.ts`: round-trip、legacy、invalid inputのunit test。
- Create `src/db/createDuckDB.ts`: DuckDB、OPFS、Spatialの初期化とcapability。
- Create `src/db/geometryRepository.ts`: schema、metadata、migration、CRUD、row変換。
- Create `src/db/geometryRepository.test.ts`: row / migration mappingのunit test。
- Create `src/hooks/useGeometryFeatures.ts`: repositoryとReact stateの接続、import/export。
- Delete `src/hooks/useDuckDBStrokes.ts`: 移行完了後に旧hookを削除。
- Modify `src/App.tsx`: 新hookと明示的なstorage / migration statusを使用。
- Modify `src/components/Scene.tsx`: 共通の表示用 `RenderableStroke` 型を使用。
- Modify `src/components/StrokeEditor.tsx`: 共通の表示用 `RenderableStroke` 型を使用。
- Create `src/domain/renderableStroke.ts`: canonical featureからcanvas表示値への変換。
- Modify `tests/e2e/app.spec.ts`: refresh、reload、undo、clear、statusのintegration test。
- Create `tests/e2e/geojson.spec.ts`: import/export round-trip test。
- Create `tests/fixtures/features.geojson`: properties/style/layerを持つfixture。
- Modify `package.json`, `package-lock.json`: Vitestとtest script。
- Modify `README.md`: canonical model、fallback、test commandを反映。

---

### Task 1: Vitest導入とGeometry Helperの基礎テスト

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/geometry.test.ts`

**Interfaces:**

- Consumes: `getPolylineLength`, `getPolygonArea`, `getPolygonPerimeter`, `getCentroid`, `isPolygonCloseCandidate`
- Produces: `npm run test` とunit testの基盤

- [ ] **Step 1: Vitestをinstallし、test scriptを追加する**

Run:

```sh
npm install --save-dev vitest
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

Expected: `package.json` の `devDependencies` に `vitest`、`scripts` に `test` / `test:watch` が追加される。

- [ ] **Step 2: geometry helperのtestを書く**

Create `src/lib/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getCentroid,
  getPolygonArea,
  getPolygonPerimeter,
  getPolylineLength,
  isPolygonCloseCandidate,
} from "./geometry";

describe("geometry helpers", () => {
  it("polyline lengthを計算する", () => {
    expect(getPolylineLength([[0, 0], [3, 4], [6, 8]])).toBe(10);
  });

  it("polygon areaとperimeterを計算する", () => {
    const points: [number, number][] = [[0, 0], [4, 0], [4, 3]];
    expect(getPolygonArea(points)).toBe(6);
    expect(getPolygonPerimeter(points)).toBe(12);
  });

  it("点群のcentroidを計算する", () => {
    expect(getCentroid([[0, 0], [6, 0], [0, 6]])).toEqual([2, 2]);
    expect(getCentroid([])).toEqual([0, 0]);
  });

  it("4点以上で始点近傍に戻った場合だけpolygon候補にする", () => {
    expect(isPolygonCloseCandidate([[0, 0], [20, 0], [20, 20], [2, 2]], 5)).toBe(true);
    expect(isPolygonCloseCandidate([[0, 0], [20, 0], [2, 2]], 5)).toBe(false);
  });
});
```

- [ ] **Step 3: testを実行して既存helperがpassすることを確認する**

Run: `npm run test -- src/lib/geometry.test.ts`

Expected: 4 tests pass。

- [ ] **Step 4: commitする**

```sh
git add package.json package-lock.json src/lib/geometry.test.ts
git commit -m "test: add geometry unit test foundation"
```

---

### Task 2: Canonical Domain Model

**Files:**

- Create: `src/domain/geometryFeature.ts`
- Create: `src/domain/geometryFeature.test.ts`
- Modify: `src/lib/geometry.ts`

**Interfaces:**

- Produces:
  - `DEFAULT_LAYER_ID: "default"`
  - `DEFAULT_LAYER: Layer`
  - `createDefaultStyle(color?: string, width?: number): FeatureStyle`
  - `isFeatureGeometry(value: unknown): value is FeatureGeometry`
  - `createGeometryFeature(input: CreateGeometryFeatureInput): GeometryFeature`

- [ ] **Step 1: domain modelの失敗するtestを書く**

Create `src/domain/geometryFeature.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYER_ID,
  createDefaultStyle,
  createGeometryFeature,
  isFeatureGeometry,
} from "./geometryFeature";

describe("canonical feature model", () => {
  it("default layerとstyleを設定してfeatureを作る", () => {
    const feature = createGeometryFeature({
      id: "line-1",
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 10]] },
      createdAt: "2026-07-18T00:00:00.000Z",
    });
    expect(feature).toMatchObject({
      id: "line-1",
      properties: {},
      layerId: DEFAULT_LAYER_ID,
      style: createDefaultStyle(),
    });
  });

  it("Polygonの重複終点をcanonical formから除く", () => {
    const feature = createGeometryFeature({
      geometry: { type: "Polygon", coordinates: [[0, 0], [10, 0], [0, 10], [0, 0]] },
    });
    expect(feature.geometry.coordinates).toEqual([[0, 0], [10, 0], [0, 10]]);
  });

  it("有限値でない座標と点不足を拒否する", () => {
    expect(isFeatureGeometry({ type: "LineString", coordinates: [[0, 0]] })).toBe(false);
    expect(isFeatureGeometry({ type: "Polygon", coordinates: [[0, 0], [1, 1]] })).toBe(false);
    expect(isFeatureGeometry({ type: "LineString", coordinates: [[0, Number.NaN], [1, 1]] })).toBe(false);
  });
});
```

- [ ] **Step 2: testが未実装でfailすることを確認する**

Run: `npm run test -- src/domain/geometryFeature.test.ts`

Expected: FAIL with `Failed to resolve import "./geometryFeature"`。

- [ ] **Step 3: canonical型とconstructorを実装する**

Create `src/domain/geometryFeature.ts`:

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Point2D = [number, number];

export type FeatureGeometry =
  | { type: "LineString"; coordinates: Point2D[] }
  | { type: "Polygon"; coordinates: Point2D[] };

export interface FeatureStyle {
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  fillOpacity?: number;
}

export interface GeometryFeature {
  id: string;
  geometry: FeatureGeometry;
  properties: Record<string, JsonValue>;
  style: FeatureStyle;
  layerId: string;
  createdAt: string;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  order: number;
  createdAt: string;
}

export interface CreateGeometryFeatureInput {
  id?: string;
  geometry: FeatureGeometry;
  properties?: Record<string, JsonValue>;
  style?: FeatureStyle;
  layerId?: string;
  createdAt?: string;
}

export const DEFAULT_LAYER_ID = "default";
export const DEFAULT_LAYER: Layer = {
  id: DEFAULT_LAYER_ID,
  name: "Default",
  visible: true,
  order: 0,
  createdAt: "1970-01-01T00:00:00.000Z",
};

export const createDefaultStyle = (strokeColor = "#222222", strokeWidth = 4): FeatureStyle => ({
  strokeColor,
  strokeWidth,
});

const isPoint2D = (value: unknown): value is Point2D =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "number" &&
  Number.isFinite(value[0]) &&
  typeof value[1] === "number" &&
  Number.isFinite(value[1]);

export const isFeatureGeometry = (value: unknown): value is FeatureGeometry => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(candidate.coordinates) || !candidate.coordinates.every(isPoint2D)) return false;
  if (candidate.type === "LineString") return candidate.coordinates.length >= 2;
  if (candidate.type === "Polygon") return candidate.coordinates.length >= 3;
  return false;
};

const normalizeGeometry = (geometry: FeatureGeometry): FeatureGeometry => {
  const coordinates = geometry.coordinates.map(([x, y]) => [x, y] as Point2D);
  if (
    geometry.type === "Polygon" &&
    coordinates.length > 1 &&
    coordinates[0][0] === coordinates.at(-1)?.[0] &&
    coordinates[0][1] === coordinates.at(-1)?.[1]
  ) {
    coordinates.pop();
  }
  const normalized = { type: geometry.type, coordinates } as FeatureGeometry;
  if (!isFeatureGeometry(normalized)) throw new Error("Invalid feature geometry");
  return normalized;
};

export const createGeometryFeature = (input: CreateGeometryFeatureInput): GeometryFeature => ({
  id: input.id ?? crypto.randomUUID(),
  geometry: normalizeGeometry(input.geometry),
  properties: input.properties ?? {},
  style: input.style ?? createDefaultStyle(),
  layerId: input.layerId ?? DEFAULT_LAYER_ID,
  createdAt: input.createdAt ?? new Date().toISOString(),
});
```

Modify the first line of `src/lib/geometry.ts`:

```ts
export type { Point2D } from "../domain/geometryFeature";
import type { Point2D } from "../domain/geometryFeature";
```

- [ ] **Step 4: domainと既存geometry testを実行する**

Run: `npm run test -- src/domain/geometryFeature.test.ts src/lib/geometry.test.ts`

Expected: 7 tests pass。

- [ ] **Step 5: commitする**

```sh
git add src/domain/geometryFeature.ts src/domain/geometryFeature.test.ts src/lib/geometry.ts
git commit -m "feat: add canonical geometry feature model"
```

---

### Task 3: GeoJSON Codec

**Files:**

- Create: `src/lib/geojson.ts`
- Create: `src/lib/geojson.test.ts`

**Interfaces:**

- Consumes: `GeometryFeature`, `Layer`, `FeatureStyle`
- Produces:
  - `exportFeatureCollection(features: GeometryFeature[], layers: Layer[]): GeoJSONFeatureCollection`
  - `importFeatureCollection(input: unknown, existingIds?: ReadonlySet<string>): ImportedGeoJSON`
  - `ImportedGeoJSON = { features: GeometryFeature[]; layers: Layer[]; warnings: string[] }`

- [ ] **Step 1: round-tripとlegacy互換の失敗するtestを書く**

Create `src/lib/geojson.test.ts` with three tests:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER, createGeometryFeature } from "../domain/geometryFeature";
import { exportFeatureCollection, importFeatureCollection } from "./geojson";

describe("GeoJSON codec", () => {
  it("canonical fieldをLineStringでround-tripする", () => {
    const feature = createGeometryFeature({
      id: "line-1",
      geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
      properties: { name: "road", nested: { rank: 2 } },
      style: { strokeColor: "#ff0000", strokeWidth: 7 },
      createdAt: "2026-07-18T00:00:00.000Z",
    });
    const imported = importFeatureCollection(exportFeatureCollection([feature], [DEFAULT_LAYER]));
    expect(imported.warnings).toEqual([]);
    expect(imported.features[0]).toEqual(feature);
    expect(imported.layers).toEqual([DEFAULT_LAYER]);
  });

  it("Polygon ringをexport時に閉じ、import時に開く", () => {
    const feature = createGeometryFeature({
      id: "polygon-1",
      geometry: { type: "Polygon", coordinates: [[0, 0], [10, 0], [0, 10]] },
    });
    const exported = exportFeatureCollection([feature], [DEFAULT_LAYER]);
    expect(exported.features[0].geometry.coordinates).toEqual([[[0, 0], [10, 0], [0, 10], [0, 0]]]);
    expect(importFeatureCollection(exported).features[0].geometry.coordinates).toEqual([[0, 0], [10, 0], [0, 10]]);
  });

  it("legacy propertiesをstyleへ変換しreserved fieldを除く", () => {
    const imported = importFeatureCollection({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      properties: { id: "legacy-1", color: "#00ff00", width: 3, geomType: "line", label: "kept" },
    });
    expect(imported.features[0]).toMatchObject({
      id: "legacy-1",
      properties: { label: "kept" },
      style: { strokeColor: "#00ff00", strokeWidth: 3 },
    });
  });
});
```

- [ ] **Step 2: testが未実装でfailすることを確認する**

Run: `npm run test -- src/lib/geojson.test.ts`

Expected: FAIL with `Failed to resolve import "./geojson"`。

- [ ] **Step 3: codecを実装する**

`src/lib/geojson.ts` では次を実装する。

```ts
export interface ImportedGeoJSON {
  features: GeometryFeature[];
  layers: Layer[];
  warnings: string[];
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry:
      | { type: "LineString"; coordinates: Point2D[] }
      | { type: "Polygon"; coordinates: Point2D[][] };
    properties: Record<string, JsonValue>;
    workbench: { style: FeatureStyle; layerId: string; createdAt: string };
  }>;
  workbench: { layers: Layer[] };
}
```

Implementation requirements:

```ts
// export:
// 1. user propertiesをそのままpropertiesへコピーする。
// 2. Polygonだけ `[...coordinates, coordinates[0]]` をouter ringにする。
// 3. style/layerId/createdAtをFeature.workbenchへ保存する。
// 4. 参照されたlayerだけをFeatureCollection.workbench.layersへ保存する。
//
// import:
// 1. FeatureをFeatureCollectionへ正規化する。
// 2. LineString/Polygonをcanonical coordinatesへ変換する。
// 3. workbench metadataを優先し、なければlegacy propertiesを読む。
// 4. id/color/width/geomTypeをuser propertiesから除く。
// 5. layer metadataが不正ならDEFAULT_LAYERを使う。
// 6. existingIdsまたは同一file内でIDが衝突したらcrypto.randomUUID()を使う。
// 7. 非対応featureはskipし、warningsへ理由を追加する。
```

実装では `createGeometryFeature()` と `isFeatureGeometry()` を必ず通し、外部入力を型castだけで信用しない。

- [ ] **Step 4: codec testを実行する**

Run: `npm run test -- src/lib/geojson.test.ts`

Expected: 3 tests pass。

- [ ] **Step 5:全unit testを実行する**

Run: `npm run test`

Expected: all tests pass。

- [ ] **Step 6: commitする**

```sh
git add src/lib/geojson.ts src/lib/geojson.test.ts
git commit -m "feat: add canonical GeoJSON codec"
```

---

### Task 4: DuckDB初期化とGeometry Repository

**Files:**

- Create: `src/db/createDuckDB.ts`
- Create: `src/db/geometryRepository.ts`
- Create: `src/db/geometryRepository.test.ts`

**Interfaces:**

- Produces:
  - `DuckDBCapabilities = { opfs: boolean; spatial: boolean; store: "spatial" | "json" }`
  - `createDuckDB(): Promise<{ db; connection; capabilities }>`
  - `GeometryRepository.initialize(): Promise<{ migrationWarning?: string }>`
  - `listFeatures`, `insertFeature`, `updateGeometry`, `deleteLatestFeature`, `clearFeatures`
  - `listLayers`, `insertLayers`

- [ ] **Step 1: pure row / legacy mappingの失敗するtestを書く**

Create `src/db/geometryRepository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER_ID } from "../domain/geometryFeature";
import { mapJsonFeatureRow, mapLegacyJsonRow } from "./geometryRepository";

describe("geometry repository row mapping", () => {
  it("JSON store rowをcanonical featureへ変換する", () => {
    const feature = mapJsonFeatureRow({
      id: "line-1",
      geom_type: "LineString",
      coordinates: "[[0,0],[2,2]]",
      properties: '{"name":"a"}',
      style: '{"strokeColor":"#123456","strokeWidth":5}',
      layer_id: DEFAULT_LAYER_ID,
      created_at: "2026-07-18T00:00:00.000Z",
    });
    expect(feature).toMatchObject({ id: "line-1", properties: { name: "a" } });
  });

  it("legacy JSON rowをDefault layerへ変換する", () => {
    const feature = mapLegacyJsonRow({
      id: "legacy-1",
      coords: "[[0,0],[2,2]]",
      color: "#abcdef",
      width: 6,
      geom_type: "line",
      created_at: "2026-07-18T00:00:00.000Z",
    });
    expect(feature).toMatchObject({
      id: "legacy-1",
      layerId: DEFAULT_LAYER_ID,
      properties: {},
      style: { strokeColor: "#abcdef", strokeWidth: 6 },
    });
  });
});
```

- [ ] **Step 2: testが未実装でfailすることを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: FAIL with unresolved module。

- [ ] **Step 3: DuckDB bootstrapを旧hookから分離する**

Implement `src/db/createDuckDB.ts` by moving the worker, instantiate, OPFS open, connection, and Spatial load logic from `useDuckDBStrokes.ts`. Return capability state explicitly:

```ts
export type FeatureStore = "spatial" | "json";

export interface DuckDBCapabilities {
  opfs: boolean;
  spatial: boolean;
  store: FeatureStore;
}

export interface DuckDBContext {
  db: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
  capabilities: DuckDBCapabilities;
}
```

Use `app_metadata.active_feature_store` when it exists. On a new DB select `spatial` only when Spatial loaded. If metadata says `spatial` but Spatial did not load, throw `StoredFeatureStoreUnavailableError`; do not switch to an empty JSON store.

- [ ] **Step 4: repository schemaとCRUDを実装する**

Implement `src/db/geometryRepository.ts` with prepared statements for all values. Required SQL:

```sql
CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS layers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  visible BOOLEAN NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

Spatial store:

```sql
CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  geom GEOMETRY NOT NULL,
  properties JSON NOT NULL,
  style JSON NOT NULL,
  layer_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

JSON store:

```sql
CREATE TABLE IF NOT EXISTS features_json (
  id TEXT PRIMARY KEY,
  geom_type TEXT NOT NULL,
  coordinates JSON NOT NULL,
  properties JSON NOT NULL,
  style JSON NOT NULL,
  layer_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

`initialize()` must:

1. create metadata/layers/active store;
2. insert `DEFAULT_LAYER` with `ON CONFLICT DO NOTHING`;
3. run `BEGIN TRANSACTION`;
4. inspect `information_schema.tables` for both legacy tables;
5. map both sources, deduplicate by ID with `strokes` precedence;
6. insert with `ON CONFLICT DO NOTHING`;
7. set `legacy_strokes_migrated=true`;
8. `COMMIT`, or `ROLLBACK` and return a migration warning.

Spatial geometry conversion uses:

```sql
ST_GeomFromText(CAST(? AS VARCHAR))
ST_AsGeoJSON(geom)
```

JSON store writes canonical `FeatureGeometry.coordinates` directly. `updateGeometry()` preserves ID, properties, style, layer, and createdAt. 描画時のsimplifyはrepositoryの外にあるTypeScript共通純粋関数で実行し、両storeへ同じcanonical geometryを渡す。`ST_Simplify` はこの永続化経路では使用しない。

- [ ] **Step 5: row mapping testと全unit testを実行する**

Run:

```sh
npm run test -- src/db/geometryRepository.test.ts
npm run test
```

Expected: all tests pass。

- [ ] **Step 6: lintとbuildで型を検証する**

Run:

```sh
npm run lint
npm run build
```

Expected: both commands exit 0。

- [ ] **Step 7: commitする**

```sh
git add src/db/createDuckDB.ts src/db/geometryRepository.ts src/db/geometryRepository.test.ts
git commit -m "feat: add DuckDB geometry repository"
```

---

### Task 5: React HookとCanvas Adapterの切替

**Files:**

- Create: `src/domain/renderableStroke.ts`
- Create: `src/domain/renderableStroke.test.ts`
- Create: `src/hooks/useGeometryFeatures.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Scene.tsx`
- Modify: `src/components/StrokeEditor.tsx`
- Delete: `src/hooks/useDuckDBStrokes.ts`

**Interfaces:**

- Produces:
  - `RenderableStroke`
  - `toRenderableStroke(feature: GeometryFeature): RenderableStroke`
  - `simplifyFeatureGeometry(geometry: FeatureGeometry, tolerance: number): FeatureGeometry`
  - `useGeometryFeatures(strokeColor, strokeWidth, simplifyOn)`
  - `storageStatus: { opfs; spatial; store; migrationWarning?; error? }`

- [ ] **Step 1: canvas adapterの失敗するtestを書く**

Create `src/domain/renderableStroke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createGeometryFeature } from "./geometryFeature";
import { toRenderableStroke } from "./renderableStroke";

it("canonical Polygonを計測値つきRenderableStrokeへ変換する", () => {
  const stroke = toRenderableStroke(createGeometryFeature({
    id: "polygon-1",
    geometry: { type: "Polygon", coordinates: [[0, 0], [4, 0], [4, 3]] },
    style: { strokeColor: "#ff0000", strokeWidth: 2 },
  }));
  expect(stroke).toMatchObject({
    id: "polygon-1",
    color: "#ff0000",
    width: 2,
    geomType: "polygon",
    area: 6,
    perimeter: 12,
  });
});
```

- [ ] **Step 2: adapterを実装する**

`src/domain/renderableStroke.ts`:

```ts
import type { GeometryFeature, Point2D } from "./geometryFeature";
import { getPolygonArea, getPolygonPerimeter, getPolylineLength } from "../lib/geometry";

export interface RenderableStroke {
  id: string;
  color: string;
  width: number;
  ptsPx: Point2D[];
  geomType: "line" | "polygon";
  length?: number;
  area?: number;
  perimeter?: number;
}

export const toRenderableStroke = (feature: GeometryFeature): RenderableStroke => {
  const polygon = feature.geometry.type === "Polygon";
  const ptsPx = feature.geometry.coordinates;
  return {
    id: feature.id,
    color: feature.style.strokeColor,
    width: feature.style.strokeWidth,
    ptsPx,
    geomType: polygon ? "polygon" : "line",
    length: polygon ? undefined : getPolylineLength(ptsPx),
    area: polygon ? getPolygonArea(ptsPx) : undefined,
    perimeter: polygon ? getPolygonPerimeter(ptsPx) : undefined,
  };
};
```

- [ ] **Step 3: hookをrepository APIで実装する**

Move UI orchestration from `useDuckDBStrokes.ts` to `useGeometryFeatures.ts`:

- initialize DB/repository in one effect and close connection/worker on cleanup;
- keep `features`, `layers`, `loading`, and `storageStatus` in state;
- derive `strokes = features.map(toRenderableStroke)`;
- `simplifyFeatureGeometry()` はDouglas-Peucker法をLineStringへ適用し、Polygonでは開いたringのまま各頂点を処理して最低3点を維持する。toleranceが0以下なら同じ座標値のcopyを返す;
- `persistStroke(points, geomType)` は `simplifyOn` のとき `Math.max(0, Math.min(strokeWidth * 0.3, 3))` をtoleranceとして共通simplifierを適用し、結果から `DEFAULT_LAYER_ID` のcanonical featureを作る;
- `updateStroke(id, points)` calls `repository.updateGeometry`;
- undo/clear/refresh call repository methods;
- import parses file with `importFeatureCollection`, inserts layers then features, and reports skipped feature count;
- export uses `exportFeatureCollection`, Blob, object URL, and anchor download;
- repository failure sets a visible error and retains the last successful state.

- [ ] **Step 4: Appとcanvas componentを切り替える**

In `src/App.tsx`:

```ts
import { useGeometryFeatures } from "./hooks/useGeometryFeatures";
import type { RenderableStroke } from "./domain/renderableStroke";
```

Replace `useDuckDBStrokes` usages with `useGeometryFeatures`. Replace the warning overlay and footer with status derived from:

```ts
const storageLabel = storageStatus.opfs ? "OPFS" : "メモリ";
const engineLabel = storageStatus.store === "spatial" ? "Spatial" : "JSON fallback";
```

Required visible strings:

- `永続ストレージ: OPFS / Spatial`
- `永続ストレージ: OPFS / JSON fallback`
- `一時ストレージ: メモリ / Spatial`
- `一時ストレージ: メモリ / JSON fallback`

Show `migrationWarning` and `error` in `role="status"` / `role="alert"` elements with stable test IDs.

Use `RenderableStroke` in `Scene.tsx`, `StrokeEditor.tsx`, and `WorkspaceProps`; remove their duplicate local `Stroke` interfaces.

- [ ] **Step 5: unit test、lint、buildを実行する**

Run:

```sh
npm run test
npm run lint
npm run build
```

Expected: all commands exit 0。

- [ ] **Step 6:旧hookを削除してcommitする**

```sh
git rm src/hooks/useDuckDBStrokes.ts
git add src/domain/renderableStroke.ts src/domain/renderableStroke.test.ts \
  src/hooks/useGeometryFeatures.ts src/App.tsx src/components/Scene.tsx \
  src/components/StrokeEditor.tsx
git commit -m "refactor: connect React to canonical feature repository"
```

---

### Task 6: Browser Integration Test

**Files:**

- Modify: `tests/e2e/app.spec.ts`
- Create: `tests/e2e/geojson.spec.ts`
- Create: `tests/fixtures/features.geojson`

**Interfaces:**

- Consumes: existing toolbar accessible names and new storage status test ID
- Produces: real DuckDB WASM persistence and GeoJSON integration coverage

- [ ] **Step 1: GeoJSON fixtureを作成する**

Create `tests/fixtures/features.geojson`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "fixture-line",
      "geometry": {
        "type": "LineString",
        "coordinates": [[100, 100], [240, 180]]
      },
      "properties": {
        "name": "Fixture road",
        "rank": 2
      },
      "workbench": {
        "style": {
          "strokeColor": "#e11d48",
          "strokeWidth": 5
        },
        "layerId": "default",
        "createdAt": "2026-07-18T00:00:00.000Z"
      }
    }
  ],
  "workbench": {
    "layers": [
      {
        "id": "default",
        "name": "Default",
        "visible": true,
        "order": 0,
        "createdAt": "1970-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

- [ ] **Step 2: refresh/reload、undo、clear、status testを追加する**

Add to `tests/e2e/app.spec.ts`:

```ts
test("保存したlineをrefreshとreload後に復元する", async ({ page }) => {
  await gotoApp(page);
  const box = await getCanvasBox(page);
  await page.getByRole("button", { name: "Clear" }).click();
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.click(box.x + 240, box.y + 180);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Measure" }).click();
  await expect(page.getByText(/Length: \d+\.\d px/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(/Length: \d+\.\d px/)).toBeVisible();

  const status = page.getByTestId("storage-status");
  if ((await status.textContent())?.includes("OPFS")) {
    await page.reload();
    await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText(/Length: \d+\.\d px/)).toBeVisible();
  }

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Length: \d+\.\d px/)).toHaveCount(0);
});
```

Also assert `storage-status` matches `/OPFS|メモリ/` and `/Spatial|JSON fallback/`.

- [ ] **Step 3: import/export round-trip testを追加する**

Create `tests/e2e/geojson.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("GeoJSON import/exportでgeometry typeとpropertiesを保持する", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Clear" }).click();
  await page.locator("#geojson-file-input").setInputFiles(path.resolve("tests/fixtures/features.geojson"));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GeoJSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  const exported = JSON.parse(text);

  expect(exported.features).toHaveLength(1);
  expect(exported.features[0]).toMatchObject({
    id: "fixture-line",
    geometry: { type: "LineString" },
    properties: { name: "Fixture road", rank: 2 },
    workbench: {
      style: { strokeColor: "#e11d48", strokeWidth: 5 },
      layerId: "default",
    },
  });
});
```

- [ ] **Step 4: desktop projectでE2Eを実行する**

Run: `npm run test:e2e -- --project=chromium-desktop`

Expected: all desktop tests pass。

- [ ] **Step 5: mobileを含む全E2Eを実行する**

Run: `npm run test:e2e`

Expected: all desktop/mobile tests pass。失敗時のscreenshot/traceは `.codex-artifacts/` へコピーして原因を確認する。

- [ ] **Step 6: canvas screenshotで非blank描画を確認する**

Run app with `npm run dev`, then use Playwright at desktop and mobile viewport to:

1. clear data;
2. draw a line and polygon;
3. switch to Measure;
4. save canvas screenshots under `.codex-artifacts/canonical-feature/`;
5. confirm both screenshots contain the expected geometry and measurement labels.

- [ ] **Step 7: commitする**

```sh
git add tests/e2e/app.spec.ts tests/e2e/geojson.spec.ts tests/fixtures/features.geojson
git commit -m "test: cover canonical persistence and GeoJSON workflows"
```

---

### Task 7: Documentationと最終検証

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: implemented model、storage status、commands
- Produces: 現在のarchitectureとtest workflowを説明するREADME

- [ ] **Step 1: READMEを更新する**

Update these sections:

- Features: canonical feature、Default layer、properties/styleを保持するGeoJSON。
- App Structure: `src/domain`, `src/db`, `useGeometryFeatures`.
- DuckDB Notes: active store、OPFS / memory、Spatial / JSON fallbackの4状態、legacy migration。
- Testing: `npm run test` と `npm run test:e2e` を実行commandとして記載。

- [ ] **Step 2:formatを適用する**

Run: `npm run format`

Expected: Prettier exits 0。`ROADMAP.md` にformat差分が出た場合は、その差分を戻さず、commit対象から除外する。

- [ ] **Step 3:全検証を実行する**

Run:

```sh
npm run test
npm run test:e2e
npm run lint
npm run format:check
npm run build
```

Expected: every command exits 0。Viteのchunk size warningは既知のwarningとして許容するが、errorやtest skipの増加は許容しない。

- [ ] **Step 4:意図した差分だけであることを確認する**

Run:

```sh
git status --short
git diff --check
git diff --stat main...HEAD
```

Expected: `ROADMAP.md` 以外の未追跡ファイルがなく、whitespace errorがなく、差分が本計画のfile map内に収まる。

- [ ] **Step 5:READMEをcommitする**

```sh
git add README.md
git commit -m "docs: document canonical feature persistence"
```

- [ ] **Step 6:最終commitとstatusを確認する**

Run:

```sh
git log --oneline main..HEAD
git status --short
```

Expected: taskごとのcommitが並び、statusにはユーザー所有の未追跡 `ROADMAP.md` だけが表示される。

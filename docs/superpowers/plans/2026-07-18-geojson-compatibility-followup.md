# GeoJSON互換性レビュー追加対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `crypto.randomUUID()`非対応環境でもfeatureを作成でき、3D positionを含むGeoJSONをcanonicalな2D geometryとしてimportできるようにする。

**Architecture:** ID生成をdependencyなしの共通helperへ分離し、feature作成とimportの双方から利用する。外部GeoJSON positionはcodec境界で2Dへ正規化し、domain modelの厳密な`Point2D`制約は維持する。

**Tech Stack:** TypeScript、Vitest

## Global Constraints

- altitudeはcanonical modelやdatabaseへ保存しない。
- 新しいdependencyを追加しない。
- Polygon holeや新しいgeometry typeへscopeを広げない。
- 未追跡の`ROADMAP.md`は変更しない。
- GitHub review threadへの返信・resolveは行わない。
- production codeより先に失敗するregression testを追加する。

---

### Task 1: fallback付き共通ID生成

**Files:**

- Create: `src/lib/id.ts`
- Create: `src/lib/id.test.ts`
- Modify: `src/domain/geometryFeature.ts`
- Modify: `src/lib/geojson.ts`
- Test: `src/lib/geojson.test.ts`

**Interfaces:**

- Produces: `createId(): string`
- Consumes: `globalThis.crypto?.randomUUID`

- [ ] **Step 1: ID helperの失敗テストを追加する**

```ts
it("randomUUIDが利用できない場合も空でないIDを生成する", () => {
  vi.stubGlobal("crypto", {});
  expect(createId()).toMatch(/^feature-/);
  vi.unstubAllGlobals();
});
```

`randomUUID`が利用可能なcaseではstub値をそのまま返すtestも追加する。

- [ ] **Step 2: REDを確認する**

Run: `npm run test -- src/lib/id.test.ts`

Expected: `src/lib/id.ts`が存在せずFAIL。

- [ ] **Step 3: 最小のID helperを実装する**

```ts
export const createId = (): string => {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `feature-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};
```

- [ ] **Step 4: feature作成とimportの失敗テストを追加する**

`geometryFeature`の既存test file、または新しい`id.test.ts`から`createGeometryFeature`を呼び、`crypto.randomUUID`なしでもIDを得ることを検証する。`geojson.test.ts`にはIDなしfeatureをimportできるtestを追加する。

```ts
vi.stubGlobal("crypto", {});
const feature = createGeometryFeature({ geometry });
expect(feature.id).toMatch(/^feature-/);

const imported = importFeatureCollection(collectionWithoutId);
expect(imported.features[0].id).toMatch(/^feature-/);
```

- [ ] **Step 5: REDを確認する**

Run: `npm run test -- src/lib/id.test.ts src/lib/geojson.test.ts`

Expected: 現在の直接`crypto.randomUUID()`呼び出しが例外となりFAIL。

- [ ] **Step 6: 両方のID生成をhelperへ置換する**

`createGeometryFeature`と`uniqueId`で`createId()`を使用する。入力ID維持と重複回避loopは変更しない。

- [ ] **Step 7: GREENを確認する**

Run: `npm run test -- src/lib/id.test.ts src/lib/geojson.test.ts`

Expected: randomUUID利用可能・利用不可、feature作成、importの全testがPASS。

- [ ] **Step 8: Task 1をコミットする**

```bash
git add src/lib/id.ts src/lib/id.test.ts src/domain/geometryFeature.ts src/lib/geojson.ts src/lib/geojson.test.ts
git commit -m "fix: generate feature IDs without randomUUID"
```

### Task 2: 3D GeoJSON positionの2D正規化

**Files:**

- Modify: `src/lib/geojson.ts`
- Test: `src/lib/geojson.test.ts`

**Interfaces:**

- Produces: GeoJSON positionを`Point2D`へ変換する内部helper
- Consumes: `canonicalGeometry(value: unknown)`

- [ ] **Step 1: 3D LineStringとPolygonの失敗テストを追加する**

```ts
expect(importFeatureCollection(lineString3d).features[0].geometry).toEqual({
  type: "LineString",
  coordinates: [
    [1, 2],
    [3, 4],
  ],
});

expect(importFeatureCollection(polygon3d).features[0].geometry).toEqual({
  type: "Polygon",
  coordinates: [
    [0, 0],
    [4, 0],
    [4, 4],
  ],
});
```

- [ ] **Step 2: REDを確認する**

Run: `npm run test -- src/lib/geojson.test.ts`

Expected: 3D positionが`isPoint2D`でrejectされ、featureが存在しないためFAIL。

- [ ] **Step 3: codec境界のposition正規化を実装する**

```ts
const point2DFromPosition = (value: unknown): Point2D | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [x, y] = value;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? [x, y] : null;
};
```

`canonicalGeometry`でringまたはLineStringの全positionをこのhelperへ通し、1件でも`null`ならgeometry全体をrejectする。正規化後に`isFeatureGeometry`とPolygon閉じ点除去を実行する。

- [ ] **Step 4: 不正positionのtestを追加する**

2要素未満、非数値、`Infinity`をそれぞれ含むgeometryがskipされ、warningを返すことを検証する。

- [ ] **Step 5: GREENを確認する**

Run: `npm run test -- src/lib/geojson.test.ts`

Expected: 3D正規化と不正position rejectionの全testがPASS。

- [ ] **Step 6: Task 2をコミットする**

```bash
git add src/lib/geojson.ts src/lib/geojson.test.ts
git commit -m "fix: normalize 3D GeoJSON positions"
```

### Task 3: 全体検証

**Files:**

- Modify if required: formatting対象fileのみ

**Interfaces:**

- Consumes: Task 1〜2の変更
- Produces: 追加review 2件に対する検証結果

- [ ] **Step 1: unit testを実行する**

Run: `npm run test`

Expected: 全test PASS、failure 0。

- [ ] **Step 2: lintとformatを確認する**

Run: `npm run lint`

Expected: error 0。

Run: `npm run format:check`

Expected: formatting issue 0。

- [ ] **Step 3: production buildを実行する**

Run: `npm run build`

Expected: exit code 0。既知のchunk size warning以外のerrorなし。

- [ ] **Step 4: working treeを確認する**

Run: `git status --short && git diff --check`

Expected: `ROADMAP.md`は未追跡のまま、対象外変更とwhitespace errorがない。

- [ ] **Step 5: 最新review threadと照合する**

追加2件を各testと実装箇所へ対応付ける。GitHubへの返信・resolveは行わない。

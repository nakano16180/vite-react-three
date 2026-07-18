# 永続化レビュー追加対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR #36に残る6件のレビュー指摘を、queue整合性、source別migration、単調な挿入順、transactional Clearによって解消する。

**Architecture:** DuckDBを永続化状態と操作順のsingle source of truthにし、React hookは全repository操作を同一queueへ直列化する。schema version 3で`insertion_order`を導入し、legacy migrationはsource別metadataで再実行を防ぐ。

**Tech Stack:** React 19、TypeScript、DuckDB WASM、Vitest、Playwright

## Global Constraints

- coordinate storage、canonical GeoJSON構造、active store選択は変更しない。
- legacy tableは削除しない。
- Clear後もDefault layerは維持する。
- 未追跡の`ROADMAP.md`は変更しない。
- GitHub review threadへの返信・resolveは行わない。
- production codeより先に失敗するregression testを追加し、REDを確認する。

---

### Task 1: schema version 3と単調な挿入順

**Files:**

- Modify: `src/db/geometryRepository.ts`
- Test: `src/db/geometryRepository.test.ts`

**Interfaces:**

- Consumes: `GeometryRepository.initialize()`、`insertFeature()`、`importGeoJSON()`、`deleteLatestFeature()`
- Produces: `CURRENT_SCHEMA_VERSION = 3`、feature tableの`insertion_order BIGINT`、`nextInsertionOrder(): Promise<number>`

- [ ] **Step 1: schema migrationの失敗テストを追加する**

`schema metadata`へ、version 1と2の両方で`insertion_order`追加、`inserted_at ASC, id ASC`による連番化、version 3への更新順を検証するtestを追加する。

```ts
it.each([1, 2])("schema version %sをinsertion_order付きversion 3へ更新する", async (version) => {
  // metadataとquery callを記録するconnectionを構築する
  await new GeometryRepository(connection, capabilities).initialize();

  expect(sqlCalls).toContainEqual(expect.stringContaining("ADD COLUMN IF NOT EXISTS insertion_order BIGINT"));
  expect(sqlCalls).toContainEqual(expect.stringContaining("ROW_NUMBER() OVER (ORDER BY inserted_at ASC, id ASC)"));
  expect(metadata.get("schema_version")).toBe("3");
});
```

- [ ] **Step 2: REDを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: `insertion_order`のDDLまたはversion 3の期待値が存在せずFAIL。

- [ ] **Step 3: schema version 3への最小migrationを実装する**

新規tableのDDLへ次を追加する。

```sql
inserted_at TIMESTAMP NOT NULL DEFAULT now(),
insertion_order BIGINT
```

version 1では`inserted_at`を追加し、version 1/2共通で`insertion_order`を追加後、window functionで既存rowを決定的に連番化する。新規DBでも同じversion 3 schemaを作成する。

- [ ] **Step 4: 複数insertとUndoの失敗テストを追加する**

`insertFeature()`を連続実行した際にinsert statementへ`1`, `2`が渡り、Undo SQLが`insertion_order DESC`を使うことを検証する。

```ts
await repository.importGeoJSON([DEFAULT_LAYER], [first, second]);
expect(insertOrders).toEqual([1, 2]);

await repository.deleteLatestFeature();
expect(deleteSql).toContain("ORDER BY insertion_order DESC");
```

- [ ] **Step 5: REDを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: insert引数にorderがなく、Undoが`inserted_at`を参照するためFAIL。

- [ ] **Step 6: 採番とUndoを実装する**

repository内で次のqueryを使い、各insertの直前にorderを採番する。

```sql
SELECT COALESCE(MAX(insertion_order), 0) + 1 AS next_order FROM features_json;
```

Spatial storeではtable名を`features`とする。INSERT columnへ`insertion_order`を加え、Undoを次へ変更する。

```sql
ORDER BY insertion_order DESC, id DESC LIMIT 1
```

- [ ] **Step 7: Task 1のGREENを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: schema migration、複数import、Undo testがPASS。

- [ ] **Step 8: Task 1をコミットする**

```bash
git add src/db/geometryRepository.ts src/db/geometryRepository.test.ts
git commit -m "fix: preserve deterministic feature insertion order"
```

### Task 2: source別legacy migration

**Files:**

- Modify: `src/db/geometryRepository.ts`
- Test: `src/db/geometryRepository.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `GeometryRepository.initialize()`、既存`legacy_strokes_migrated`
- Produces: `legacy_strokes_json_migrated`、`legacy_strokes_spatial_migrated`

- [ ] **Step 1: JSON migration再実行を再現する失敗テストを追加する**

JSON markerが`true`、Spatial markerが未設定、両legacy tableが存在する状態でinitializeし、`strokes_json`を読まずSpatial pending warningだけ返すことを検証する。

```ts
expect(metadata.get("legacy_strokes_json_migrated")).toBe("true");
expect(queries.some((sql) => sql.includes("FROM strokes_json"))).toBe(false);
expect(resultValue.migrationWarning).toContain("Spatial stroke migration is pending");
```

- [ ] **Step 2: REDを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: 現在は共通markerしか見ないため`strokes_json`が再読込されFAIL。

- [ ] **Step 3: source別markerを実装する**

次の規則をtransaction内で実装する。

```ts
const legacyComplete = (await metadataValue("legacy_strokes_migrated")) === "true";
const jsonComplete = legacyComplete || (await metadataValue("legacy_strokes_json_migrated")) === "true";
const spatialComplete = legacyComplete || (await metadataValue("legacy_strokes_spatial_migrated")) === "true";
```

tableがないsource、またはmigrationが成功したsourceだけ個別markerを`true`にする。両方完了した場合は互換用共通markerも`true`にする。

- [ ] **Step 4: 後発Spatial優先の失敗テストを追加する**

JSON marker済みで同一IDのcanonical featureが存在し、後からSpatial migrationを行う場合に、Spatial featureをupsertすることを検証する。

```ts
expect(spatialInsertSql).toContain("ON CONFLICT (id) DO UPDATE");
expect(insertedStyle.strokeColor).toBe("#222222");
```

- [ ] **Step 5: REDを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: 現在の`ON CONFLICT DO NOTHING`では置換されずFAIL。

- [ ] **Step 6: legacy Spatial用upsertを実装する**

通常insertのconflict policyは維持し、migration専用policyを追加する。

```ts
type InsertConflictPolicy = "error" | "ignore" | "replace";
```

`replace`ではgeometry、properties、style、layer_id、created_atを`EXCLUDED`値で更新する。後発Spatial migrationだけ`replace`を使う。

- [ ] **Step 7: READMEをsource別migrationの挙動に更新する**

JSON migrationが一度だけcommitされ、Spatialは利用可能になるまで独立してpendingとなること、後発Spatial rowが同一IDで優先されることを記載する。

- [ ] **Step 8: Task 2のGREENを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: source別marker、Spatial pending、後発Spatial優先testがPASS。

- [ ] **Step 9: Task 2をコミットする**

```bash
git add src/db/geometryRepository.ts src/db/geometryRepository.test.ts README.md
git commit -m "fix: track legacy migrations by source"
```

### Task 3: transactional Clearとcustom layer削除

**Files:**

- Modify: `src/db/geometryRepository.ts`
- Test: `src/db/geometryRepository.test.ts`

**Interfaces:**

- Consumes: `GeometryRepository.clearFeatures()`
- Produces: feature全削除とDefault以外のlayer削除を行うtransaction

- [ ] **Step 1: Clear成功・失敗のtestを追加する**

```ts
await repository.clearFeatures();
expect(sqlCalls).toEqual([
  "BEGIN TRANSACTION;",
  "DELETE FROM features_json;",
  `DELETE FROM layers WHERE id <> '${DEFAULT_LAYER_ID}';`,
  "COMMIT;",
]);
```

layer削除が失敗するcaseでは`ROLLBACK;`が呼ばれ、`COMMIT;`が呼ばれないことも別testで検証する。

- [ ] **Step 2: REDを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: 現在はfeature DELETEだけなのでFAIL。

- [ ] **Step 3: transactional Clearを実装する**

```ts
await connection.query("BEGIN TRANSACTION;");
try {
  await connection.query(`DELETE FROM ${table};`);
  await connection.query(`DELETE FROM layers WHERE id <> '${DEFAULT_LAYER_ID}';`);
  await connection.query("COMMIT;");
} catch (error) {
  await rollbackBestEffort();
  throw error;
}
await checkpoint();
```

- [ ] **Step 4: Task 3のGREENを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: Clear成功、rollback、Default layer維持testがPASS。

- [ ] **Step 5: Task 3をコミットする**

```bash
git add src/db/geometryRepository.ts src/db/geometryRepository.test.ts
git commit -m "fix: clear imported layer metadata with features"
```

### Task 4: queue後の最新stateを使うExport

**Files:**

- Create: `src/lib/exportGeometryFeatures.ts`
- Create: `src/lib/exportGeometryFeatures.test.ts`
- Modify: `src/hooks/useGeometryFeatures.ts`
- Modify: `tests/e2e/geojson.spec.ts`

**Interfaces:**

- Consumes: `GeometryRepository.listFeatures()`、`GeometryRepository.listLayers()`、`PromiseQueue`
- Produces: `loadExportFeatureCollection(repository): Promise<FeatureCollection>`

- [ ] **Step 1: repository stateを直接読むhelperの失敗テストを追加する**

```ts
const collection = await loadExportFeatureCollection(repository);
expect(repository.listFeatures).toHaveBeenCalledOnce();
expect(repository.listLayers).toHaveBeenCalledOnce();
expect(collection.features[0].id).toBe("fresh");
```

- [ ] **Step 2: REDを確認する**

Run: `npm run test -- src/lib/exportGeometryFeatures.test.ts`

Expected: moduleまたはfunctionが存在せずFAIL。

- [ ] **Step 3: Export helperを実装する**

```ts
export const loadExportFeatureCollection = async (repository: GeometryRepository) => {
  const [features, layers] = await Promise.all([repository.listFeatures(), repository.listLayers()]);
  return exportFeatureCollection(features, layers);
};
```

- [ ] **Step 4: queue順序を検証するtestを追加する**

pending mutationを先にenqueueし、その後のexportがmutation完了後に`fresh` stateを取得するtestを、実際の`createPromiseQueue()`とhelperを組み合わせて記述する。

```ts
const mutation = enqueue(async () => {
  await gate;
  currentFeatures = [freshFeature];
});
const exported = enqueue(() => loadExportFeatureCollection(repository));
release();
await mutation;
expect((await exported).features[0].id).toBe("fresh");
```

- [ ] **Step 5: hookを同じqueueからrepository readする形へ変更する**

`handleExportGeoJSON`内でstate closureの`features`、`layers`を使わず、次の形でcollectionを取得する。

```ts
const collection = await queueRef.current(async () => {
  const repository = repositoryRef.current;
  const generation = generationRef.current;
  if (!repository) throw new Error("GeoJSON export is unavailable until storage has loaded.");
  const exported = await loadExportFeatureCollection(repository);
  if (repositoryRef.current !== repository || generationRef.current !== generation) {
    throw new Error("GeoJSON export was cancelled because storage changed.");
  }
  return exported;
});
```

- [ ] **Step 6: Playwright regression testを追加する**

描画完了をawaitせず直後にExportをclickし、downloadに直前のfeatureが含まれることを検証する。browser timingで決定性が得られない場合はunit testを正式なregression coverageとし、flakyなE2Eは追加しない。

- [ ] **Step 7: Task 4のGREENを確認する**

Run: `npm run test -- src/lib/exportGeometryFeatures.test.ts src/lib/promiseQueue.test.ts`

Expected: helperとqueue順序testがPASS。

Run when deterministic: `npm run test:e2e -- tests/e2e/geojson.spec.ts`

Expected: GeoJSON testがPASS。

- [ ] **Step 8: Task 4をコミットする**

```bash
git add src/lib/exportGeometryFeatures.ts src/lib/exportGeometryFeatures.test.ts src/hooks/useGeometryFeatures.ts tests/e2e/geojson.spec.ts
git commit -m "fix: export repository state after queued writes"
```

### Task 5: 全体検証とreview指摘の照合

**Files:**

- Modify if required: formatting対象fileのみ

**Interfaces:**

- Consumes: Task 1〜4の全変更
- Produces: review 6件に対する検証結果

- [ ] **Step 1: unit testを実行する**

Run: `npm run test`

Expected: 全test PASS、failure 0。

- [ ] **Step 2: lintを実行する**

Run: `npm run lint`

Expected: error 0。

- [ ] **Step 3: formatを確認する**

Run: `npm run format:check`

Expected: formatting issue 0。失敗時は`npm run format`後に変更範囲を確認する。

- [ ] **Step 4: production buildを実行する**

Run: `npm run build`

Expected: exit code 0。既知のchunk size warning以外のerrorなし。

- [ ] **Step 5: 関連E2Eを実行する**

Run: `npm run test:e2e -- tests/e2e/geojson.spec.ts tests/e2e/app.spec.ts`

Expected: desktop/mobile対象testがPASS。

- [ ] **Step 6: diffと未追跡fileを確認する**

Run: `git status --short && git diff --check && git diff --stat HEAD~4..HEAD`

Expected: `ROADMAP.md`は未追跡のまま、対象外変更なし、whitespace errorなし。

- [ ] **Step 7: 未解決review 6件を再取得して実装と照合する**

thread-aware comment取得scriptを再実行し、各指摘をtestまたは実装箇所へ対応付ける。GitHubへのreply・resolveは行わない。

- [ ] **Step 8: 検証結果をコミットする必要がある場合のみコミットする**

format修正などが発生した場合に限り、対象fileだけをstageする。

```bash
git add <変更した対象file>
git commit -m "chore: finalize persistence review fixes"
```

# legacy geom_type補完 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `geom_type` columnを持たないlegacy stroke tableを、canonical feature migrationのSELECT前に互換補完する。

**Architecture:** source別migration transaction内で、存在するlegacy tableへidempotentなALTERを実行する。Spatial tableはSpatial extensionを利用できる場合だけ補完・読込する。

**Tech Stack:** TypeScript、DuckDB WASM、Vitest

## Global Constraints

- legacy rowのdefault geometry typeは`line`とする。
- legacy tableを削除しない。
- canonical schema versionを変更しない。
- 未追跡の`ROADMAP.md`は変更しない。
- GitHub review threadへの返信・resolveは行わない。
- production codeより先に失敗するregression testを追加する。

---

### Task 1: legacy geom_typeの互換補完

**Files:**

- Modify: `src/db/geometryRepository.ts`
- Test: `src/db/geometryRepository.test.ts`

**Interfaces:**

- Consumes: `GeometryRepository.initialize()`、`legacyTables()`
- Produces: legacy source SELECT前のidempotent ALTER

- [ ] **Step 1: JSON/Spatialの失敗テストを追加する**

query call順を記録するconnectionを作り、各sourceでALTERがSELECTより前に実行されることを検証する。

```ts
expect(
  sqlCalls.indexOf("ALTER TABLE strokes_json ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line';")
).toBeLessThan(sqlCalls.findIndex((sql) => sql.includes("FROM strokes_json")));

expect(sqlCalls.indexOf("ALTER TABLE strokes ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line';")).toBeLessThan(
  sqlCalls.findIndex((sql) => sql.includes("FROM strokes ORDER BY"))
);
```

Spatial unavailable caseでは、`strokes`のALTERとSELECTがどちらも呼ばれないことを既存pending testへ追加する。

- [ ] **Step 2: REDを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: legacy ALTERが存在しないためJSON/Spatial testがFAIL。

- [ ] **Step 3: 最小実装を追加する**

source別markerが未完了かつtableが存在する場合、各SELECTの直前に次を実行する。

```ts
await connection.query("ALTER TABLE strokes_json ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line';");
```

```ts
await connection.query("ALTER TABLE strokes ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line';");
```

Spatial側は`capabilities.spatial === true`の場合だけ実行する。

- [ ] **Step 4: GREENを確認する**

Run: `npm run test -- src/db/geometryRepository.test.ts`

Expected: ALTER順序、Spatial pending、既存migration testがすべてPASS。

- [ ] **Step 5: Task 1をコミットする**

```bash
git add src/db/geometryRepository.ts src/db/geometryRepository.test.ts
git commit -m "fix: backfill legacy geometry type columns"
```

### Task 2: 全体検証

**Files:**

- Modify if required: formatting対象fileのみ

**Interfaces:**

- Consumes: Task 1の変更
- Produces: 最後のreview指摘に対する検証結果

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

- [ ] **Step 5: review threadと照合してpushする**

review指摘とALTER順序testを対応付け、既存PR branchへcommitをpushする。GitHubへの返信・resolveは行わない。

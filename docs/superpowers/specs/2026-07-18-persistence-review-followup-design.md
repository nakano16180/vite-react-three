# Persistence Review Follow-up Design

## Goal

Resolve the six unresolved review threads on PR #36 without changing the canonical geometry model or the sticky Spatial/JSON store policy.

## Export consistency

GeoJSON export must use repository state observed after all previously queued repository operations finish. The export handler will keep the existing initialization guard, enqueue an export operation on the same promise queue used by draw, import, undo, clear, and refresh, then load features and layers directly from the active repository before creating the download.

This prevents both empty exports during initialization and stale exports immediately after a queued mutation. Export remains read-only and does not trigger a checkpoint.

## Legacy migration state

Legacy JSON and Spatial sources will have independent migration metadata:

- `legacy_strokes_json_migrated`
- `legacy_strokes_spatial_migrated`

Each available source is migrated once and marked complete in the same transaction as its feature inserts. A missing legacy table counts as complete for that source. A present Spatial table remains pending while Spatial functions are unavailable, without causing completed JSON migration to replay.

The existing `legacy_strokes_migrated` key remains as compatibility metadata. Existing databases with that key set to `true` are treated as fully migrated. New initialization sets it after both source-specific states are complete.

Spatial rows continue to take precedence over JSON rows with the same ID when both sources are migrated together. If JSON was migrated in an earlier non-Spatial session, later Spatial migration replaces a same-ID JSON-derived feature so the precedence rule remains true.

## Stable insertion order and Undo

Schema version 3 adds `insertion_order BIGINT` to the active feature table. It is the canonical operation-order field used by Undo; `created_at` remains canonical user data and `inserted_at` remains available only for schema migration compatibility.

Every feature insert allocates the next integer order inside the repository transaction. Multi-feature imports therefore receive increasing values in file order even when they share a transaction timestamp. Undo deletes the highest `insertion_order`.

When upgrading schema version 2, existing rows receive deterministic consecutive orders based on `inserted_at ASC, id ASC`. Schema version 1 first gains `inserted_at` as required by the existing migration, then receives insertion orders using the same rule. The schema version is updated only after the active table is fully migrated.

## Clear semantics and layers

Clear is a transaction that deletes all features and all non-Default layers. The Default layer remains available. The checkpoint occurs after commit; failures before commit roll back both deletions.

Layer import keeps the existing conflict behavior because Clear now removes stale imported layers. Existing layer definitions are not silently overwritten by an unrelated import unless the user clears first.

## Error handling

Queued export failures surface through the existing storage error state and never create a partial download. Repository generation checks prevent an export queued for an obsolete DuckDB instance from updating current UI state.

Migration failures before commit roll back source markers and feature changes together. A checkpoint failure after commit remains a durability warning and does not cause a completed source migration to replay in the current database state.

## Testing

Test-driven changes will cover:

- Export waits for a pending repository mutation and reads fresh repository state.
- JSON legacy migration is not replayed while Spatial migration remains pending.
- Later Spatial migration replaces a same-ID JSON legacy feature.
- Multi-feature import assigns monotonic insertion order and Undo removes the last imported feature.
- Schema versions 1 and 2 migrate deterministically to version 3.
- Clear removes features and custom layers atomically while preserving the Default layer.

The final verification set is `npm run test`, `npm run lint`, `npm run format:check`, and `npm run build`. Relevant Playwright tests will also run when the export behavior can be exercised deterministically in the browser harness.

## Scope boundaries

- Do not change coordinate storage, canonical GeoJSON structure, or active store selection.
- Do not delete legacy tables.
- Do not modify the unrelated untracked `ROADMAP.md`.
- Do not reply to or resolve GitHub review threads without explicit authorization.

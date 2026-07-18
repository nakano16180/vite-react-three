# 永続化レビュー追加対応 設計書

## 目的

canonical geometry modelおよびSpatial/JSON storeのsticky選択方針を維持したまま、PR #36に残っている6件の未解決レビュー指摘へ対応する。

## Exportの整合性

GeoJSON Exportでは、先にqueueへ登録されたrepository操作がすべて完了した後のrepository stateを使用しなければならない。既存の初期化完了ガードは維持する。Export処理をdraw、import、undo、clear、refreshと同じpromise queueへ登録し、実行時にactive repositoryからfeatureとlayerを直接読み直してからdownloadを生成する。

これにより、初期化中の空Exportと、mutationをqueueへ登録した直後の古いstateによるExportの両方を防ぐ。Exportはread-only操作とし、checkpointは実行しない。

## legacy migrationの状態管理

legacy JSON sourceとSpatial sourceについて、次のmetadataでmigration状態を個別に管理する。

- `legacy_strokes_json_migrated`
- `legacy_strokes_spatial_migrated`

利用可能なsourceは一度だけ移行し、featureのinsertと同じtransaction内で完了markerを設定する。対応するlegacy tableが存在しない場合、そのsourceは完了として扱う。Spatial tableが存在してもSpatial functionを利用できない場合、Spatial側はpendingのままとする。この状態でも完了済みのJSON migrationは次回起動時に再実行しない。

既存の`legacy_strokes_migrated` keyは互換用metadataとして残す。この値が`true`の既存databaseは、両sourceとも移行済みとして扱う。新しい初期化処理では、source別の両状態が完了した後にこのkeyも設定する。

両sourceを同時に移行する場合、同一IDでは従来どおりSpatial rowをJSON rowより優先する。Spatialを利用できないsessionでJSON側を先に移行した後、別のsessionでSpatial側を移行する場合も、同一IDのJSON由来featureをSpatial rowで置換し、優先規則を維持する。

## 安定した挿入順とUndo

schema version 3でactive feature tableへ`insertion_order BIGINT`を追加する。Undoが使用する正式な操作順序fieldは`insertion_order`とする。`created_at`はcanonicalなuser dataとして維持し、`inserted_at`はschema migrationの互換用途にのみ残す。

すべてのfeature insertで、repository transaction内における次の整数orderを割り当てる。これにより、複数featureのimportでも、同じtransaction timestampを持つかどうかにかかわらずfile内の順序どおりに増加する値を得られる。Undoは最大の`insertion_order`を持つfeatureを削除する。

schema version 2からのupgradeでは、既存rowへ`inserted_at ASC, id ASC`の順で決定的な連番を割り当てる。schema version 1では、既存migrationどおり先に`inserted_at`を追加し、その後に同じ規則で`insertion_order`を割り当てる。active tableのmigrationがすべて完了した後にだけschema versionを更新する。

## Clearの意味とlayer

Clearは、すべてのfeatureとDefault以外の全layerを削除するtransactionとする。Default layerは残す。checkpointはcommit後に実行し、commit前に失敗した場合は両方の削除をrollbackする。

Clearによって古いimport済みlayerを削除するため、layer importの既存のconflict処理は維持する。ユーザーが先にClearしない限り、関係のないimportによって既存layer定義を暗黙に上書きしない。

## エラー処理

queueへ登録したExportが失敗した場合は、既存のstorage error stateへ表示し、不完全なdownloadを生成しない。repository generationを検証し、古いDuckDB instance用にqueueへ登録されたExportが現在のUI stateを更新しないようにする。

migrationがcommit前に失敗した場合は、source markerとfeature変更を同じtransactionでrollbackする。commit後のcheckpoint failureは従来どおりdurability warningとして扱い、現在のdatabase stateで完了済みsourceのmigrationを再実行しない。

## テスト

テスト駆動で次のケースを追加する。

- Exportがpending中のrepository mutationを待ち、最新のrepository stateを読み取る。
- Spatial migrationがpendingでも、完了済みのJSON legacy migrationを再実行しない。
- 後から実行したSpatial migrationが、同一IDのJSON legacy featureを置換する。
- 複数featureのimportで単調増加する挿入順を割り当て、Undoが最後にimportしたfeatureを削除する。
- schema version 1および2からversion 3へ決定的にmigrationする。
- Clearがfeatureとcustom layerをtransactionalに削除し、Default layerを維持する。

最終検証では`npm run test`、`npm run lint`、`npm run format:check`、`npm run build`を実行する。Export動作をbrowser harnessで決定的に再現できる場合は、関連するPlaywright testも実行する。

## 対象外

- coordinate storage、canonical GeoJSON構造、active store選択は変更しない。
- legacy tableは削除しない。
- 無関係な未追跡fileである`ROADMAP.md`は変更しない。
- 明示的な許可なしにGitHubのreview threadへ返信したり、threadをresolveしたりしない。

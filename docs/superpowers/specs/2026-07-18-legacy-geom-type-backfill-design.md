# legacy geom_type補完 設計書

## 目的

`geom_type` columnが追加される前に作成されたlegacy `strokes_json`および`strokes` tableを、canonical feature migrationで読み込めるようにする。

## 互換schema補完

legacy table一覧を取得した後、migration用SELECTを実行する前に、存在するsource tableへ互換columnを追加する。

- `strokes_json`:
  `ALTER TABLE strokes_json ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line'`
- `strokes`:
  `ALTER TABLE strokes ADD COLUMN IF NOT EXISTS geom_type VARCHAR DEFAULT 'line'`

古いdrawingはlineのみを前提としていたため、既存rowのdefaultは`line`とする。`ADD COLUMN IF NOT EXISTS`を使用し、すでに`geom_type`があるdatabaseにも安全に適用する。

Spatial extensionを利用できないsessionでは`strokes` migration自体がpendingとなるため、Spatial tableのALTERも実行しない。Spatialを利用できるsessionで、Spatial migration用SELECTより前に補完する。

## transactionとエラー処理

互換ALTERは、legacy featureのinsertおよびsource別migration marker更新と同じtransaction内で実行する。SELECTやinsertが失敗した場合はALTERを含むtransactionをrollbackし、次回初期化時に再試行する。

legacy tableは削除しない。canonical tableのschema versionも変更しない。

## テスト

テスト駆動で次を検証する。

- `strokes_json`が存在する場合、`geom_type`補完ALTERがSELECTより先に実行される。
- Spatialを利用でき、`strokes`が存在する場合、Spatial側ALTERがSELECTより先に実行される。
- Spatialを利用できない場合、`strokes`側ALTERとSELECTを実行せずpending warningを返す。
- 既存のsource別marker、row isolation、Spatial優先migration testが引き続き通る。

最終検証では`npm run test`、`npm run lint`、`npm run format:check`、`npm run build`を実行する。

## 対象外

- legacy tableの他columnは変更しない。
- legacy tableを削除しない。
- canonical schema versionを更新しない。
- 明示的な許可なしにGitHub review threadへ返信したり、threadをresolveしたりしない。

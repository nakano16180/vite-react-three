# Canonical Feature と永続化の設計

## 対象範囲

この変更では、ロードマップの直近マイルストーン1と2を実装する。

1. canonical feature / layer schemaを完成させる。
2. geometry persistenceとGeoJSON round-tripの自動テストを追加する。

レイヤーパネル、SQLエディタ、クエリ結果レイヤー、選択状態の同期は対象外とする。データモデルは複数レイヤーに対応するが、現在のUIでは組み込みの `Default` レイヤーだけを描画とimportに使用する。

## 目標

- 保存するすべてのgeometryを、安定したID、geometry、ユーザーproperties、style、layer membershipを持つデータとして表現する。
- DuckDBの初期化、schema管理、migration、CRUDをReact component stateから分離する。
- 旧 `strokes` / `strokes_json` テーブルにある既存OPFSデータを、安全な一度限りのmigrationで保持する。
- Spatial storeとJSON fallback storeで同じ外部動作を提供する。
- geometry type、ID、ユーザーproperties、style、layer membershipを失わず、対応featureをGeoJSONでround-tripできるようにする。
- 新しい責務境界に対して、再現可能なunit testとbrowser integration testを追加する。

## 対象外

- レイヤー管理UI。
- UIからの任意feature properties / style編集。
- 後のsessionでSpatialが利用可能になった場合に、JSON fallbackのrecordをSpatial tableへ昇格する処理。
- `LineString` と `Polygon` 以外のGeoJSON geometry type。
- polygon holeやmulti-geometry。
- 既存のpixel coordinate persistence modelの変更。
- canonical modelへの適応を超えたcanvas rendering / interactionのrefactor。

## Canonical Domain Model

アプリケーションは、DBとReactに依存しない型を `src/domain/geometryFeature.ts` に定義する。

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
```

アプリ内部では、Polygon座標に始点と重複する終点を保存しない。WKT / GeoJSON serializerが、それぞれの境界でouter ringを閉じる。`LineString` は有限値の点を最低2個、`Polygon` は最低3個必要とする。featureの計測値はgeometryから導出し、保存しない。

組み込みの `Default` レイヤーには固定された安定IDを使用する。初期化時にこのレイヤーを冪等に追加する。新規描画と、有効なlayer metadataを持たないimportはこのレイヤーを使用する。

## Module Boundary

### Domain

`src/domain/geometryFeature.ts` はcanonical型、定数、validation、default style生成、ID生成、feature生成を担当する。ReactとDuckDBには依存しない。

### GeoJSON Codec

`src/lib/geojson.ts` はcanonical feature / layerとGeoJSONの相互変換を担当する。GeoJSON境界でのringの開閉、対応geometryのvalidation、legacy propertiesとの互換性、import時のID衝突処理に必要な入力を扱う。browser downloadやfile inputは担当しない。

### DuckDB Repository

`src/db/geometryRepository.ts` はschema作成、metadata、legacy migration、row変換、feature CRUDを担当する。確立済みのDuckDB connectionとSpatialの利用可否を受け取り、React stateは扱わない。

`src/db/createDuckDB.ts` はworker生成、OPFS / in-memory databaseのopen、connection生成、Spatialのloadを担当する。失敗をlogに出すだけでなく、明示的なcapability stateを返す。

### React Hook

`src/hooks/useGeometryFeatures.ts` はrepository lifecycleとReact stateを担当する。`App` が必要とするfeature operationを公開し、GeoJSON codecを使ったfile importとbrowser downloadによるexportを行う。canvas componentには当面、現在必要な情報だけを持つ既存 `Stroke` 互換の表示用データを渡し、大規模なinteraction refactorを避ける。

既存の `useDuckDBStrokes.ts` は、必要な動作を上記moduleへ移した後に置き換える。

## DuckDB Schema

### Metadata

`app_metadata` は文字列のkey / valueを保存し、次を含む。

- `schema_version`: canonical schema version。
- `legacy_strokes_migrated`: legacy migration transactionが正常にcommitされた後だけ設定する。
- `active_feature_store`: `spatial` または `json`。このschemaを最初に初期化したときに選択したcanonical storeを記録する。以降のsessionでも同じstoreを使用し、空の別tableへ暗黙に切り替えない。

### Layers

`layers` は次の列を持つ。

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `visible BOOLEAN NOT NULL`
- `sort_order INTEGER NOT NULL`
- `created_at TIMESTAMP NOT NULL`

### Spatial Feature Store

Spatialをloadできた場合、`features` は次の列を持つ。

- `id TEXT PRIMARY KEY`
- `geom GEOMETRY NOT NULL`
- `properties JSON NOT NULL`
- `style JSON NOT NULL`
- `layer_id TEXT NOT NULL`
- `created_at TIMESTAMP NOT NULL`

### JSON Fallback Feature Store

Spatialを利用できない場合、`features_json` は次の列を持つ。

- `id TEXT PRIMARY KEY`
- `geom_type TEXT NOT NULL`
- `coordinates JSON NOT NULL`
- `properties JSON NOT NULL`
- `style JSON NOT NULL`
- `layer_id TEXT NOT NULL`
- `created_at TIMESTAMP NOT NULL`

1回のsessionでは、一方のcanonical feature storeだけを読み書きする。初回初期化時にSpatialを利用できれば `features`、利用できなければ `features_json` を選択し、その選択をmetadataに保持する。これにより重複読込を防ぎ、2つのtableが同時にcanonical recordを返す曖昧さをなくす。保持しているSpatial storeをSpatial利用不可のためopenできない場合は、空のJSON storeを表示せず、初期化を妨げるstore errorを通知する。

この段階ではforeign key enforcementを必須としない。repository writeではlayer IDの存在を検証し、現在のwriteはすべてDefaultレイヤーを使用する。

描画時のsimplifyはstoreへ保存する前にTypeScriptの共通純粋関数で行い、Spatial / JSONの両storeへ同じcanonical geometryを渡す。repositoryのCRUDではgeometryを追加変換しない。`ST_Simplify` は将来、生成SQLを明示するSpatial operationとして導入し、この永続化経路では使用しない。

## 初期化とLegacy Migration

初期化は次の順序で行う。

1. DuckDB WASMをinstantiateする。
2. OPFS databaseを試し、失敗した場合はin-memory databaseへfallbackする。
3. connectionを作成し、Spatialのinstall / loadを試す。
4. metadata、layers、active feature storeを作成またはupgradeする。
5. Defaultレイヤーを冪等に追加する。
6. `legacy_strokes_migrated` がなければlegacy recordを移行する。
7. active storeを記録し、repositoryとcapability statusを返す。
8. canonical featureをReact stateへloadする。

一度限りのlegacy migrationは次のように動作する。

- transaction内で実行する。
- legacy tableを読む前に、それぞれが存在するか確認する。
- `strokes` と `strokes_json` の両方が存在し、legacy geometryをdecodeできる場合は両方を読む。
- feature IDで重複を除いてactive canonical storeへinsertする。同じIDが両tableにある場合、primary legacy pathで生成されたSpatial geometryを持つ `strokes` を優先する。
- legacy `color` / `width` を `FeatureStyle` へ変換する。
- ユーザーpropertiesには空objectを使用する。
- Defaultレイヤーを割り当てる。
- legacy IDと作成日時が有効なら保持する。
- 不正なrowはskipし、warning countを記録する。
- canonical insertとmetadata updateがcommitされた場合だけ `legacy_strokes_migrated` を設定する。
- legacy tableはどちらも削除しない。

transactionが失敗した場合はrollbackし、legacy tableを変更せず、初期化済みcanonical storeを使ってアプリを継続する。hookはmigration warningをUIへ公開する。完了markerが書かれていないため、次回reload時にmigrationを再試行する。

## CapabilityとError Status

アプリケーションはstorage動作を次のように明示する。

- OPFS + Spatial: 永続的なSpatial store。
- OPFS + Spatialなし: 永続的なJSON fallback store。
- In-memory + Spatial: 非永続的なSpatial store。
- In-memory + Spatialなし: 非永続的なJSON fallback store。

fallbackでは保存・再描画できないとする現在の誤ったmessageは削除する。初期化、migration、import、exportのerrorは簡潔なuser-visible messageを表示し、診断用の詳細errorはconsoleに残す。feature mutationはrepository operationに成功した後だけstateをreloadする。

## GeoJSON Contract

exportは標準の `FeatureCollection` を使用する。

- canonical feature IDはGeoJSON Featureの `id` に保存する。
- ユーザーpropertiesは `properties` に変更せず保存する。
- アプリ固有fieldはFeatureのforeign memberに保存する。

```json
{
  "workbench": {
    "style": {
      "strokeColor": "#222222",
      "strokeWidth": 4
    },
    "layerId": "default"
  }
}
```

- export対象featureから参照されるlayer定義は、FeatureCollectionのforeign member `workbench.layers` に保存する。
- export時にPolygon outer ringを閉じる。

importは次のように動作する。

- FeatureまたはFeatureCollectionを受け付ける。
- 有効な `LineString` / `Polygon` geometryだけを受け付ける。
- canonical modelへ変換するとき、Polygonの重複した終点を削除する。
- ユーザーproperties内の有効なJSON valueを保持する。
- 認識可能な `workbench.style` / `workbench.layerId` metadataを使用する。
- featureより先に、参照されるlayer定義をimportする。
- layer metadataがない、または不正な場合はDefaultレイヤーを割り当てる。
- 入力に有効なIDがない場合、または既存featureとIDが衝突する場合は、新しいfeature IDを生成する。
- 後方互換のため、既存形式の `properties.id`、`properties.color`、`properties.width`、`properties.geomType` を読み取る。transportに使われていたこれらのlegacy reserved fieldはcanonical user propertiesへコピーしない。
- canonical / legacy style metadataのどちらも有効でない場合はdefault styleを適用する。

これにより、アプリ固有metadataを持たない外部GeoJSONをimportでき、アプリがexportしたデータはcanonical fieldをすべてround-tripできる。

## Test Strategy

Vitestをunit test runnerとして追加し、`npm run test` で実行できるようにする。

unit testは次を対象とする。

- Polyline length、polygon area、perimeter、centroid、polygon closing。
- Canonical geometry validationとdefault feature / style生成。
- LineString / PolygonのGeoJSON round-trip。
- ID、ユーザーproperties、style、layer membershipの保持。
- Polygon ring normalization。
- 不正なcoordinateと非対応geometryの拒否。
- Legacy GeoJSON propertiesの変換。
- Repository row変換と、SQLに依存しないmigration mapping。

Playwrightは実browser applicationとDuckDB WASMに対して引き続き実行する。integration testは次を対象とする。

- OPFS利用可能時、保存したline / polygonがrefreshとpage reload後も復元される。
- Active Spatial / JSON fallback storeに対応した明確なstatus text。
- GeoJSON import後にexportし、geometry typeとユーザーpropertiesが保持されること。
- 既存のdraw、measure、undo、clear workflow。

browser testは自身が作成したapplication dataをclearし、一意なfeature IDを使用する。OPFS persistenceに依存するassertionは、最初にアプリがOPFS利用可能と報告していることを確認する。OPFSを利用できない環境では、そのcapability固有のassertionだけをskipする。canvas rendering testは決定的なviewport sizeを使用し、可能な場合はscreenshotで確認する。

必須のvalidation commandは次のとおり。

```sh
npm run test
npm run test:e2e
npm run lint
npm run build
```

## CompatibilityとRollout

- 既存のpixel coordinateは変更しない。
- 復旧用にlegacy tableを残す。
- 現在のdrawing、editing、measurement、pan、undo、clear、refresh、GeoJSON UI entry pointを維持する。
- Layer management UIを追加する前に、canonical modelでlayer membershipを公開する。
- Repository boundaryを、将来のdocumented SQL viewとquery result layerの接続点にする。

## Success Criteria

- 有効な既存legacy recordが、legacy tableを削除せず、一度限りのmigration後にDefaultレイヤーへ表示される。
- line / polygonを描画し、active canonical storeからreloadして、そのstyleでrenderできる。
- 対応featureをcanonical modelからGeoJSONへ変換し、再びcanonical modelへ戻したとき、geometry type、ID、ユーザーproperties、style、layer membershipが失われない。
- Spatial storeとJSON fallback storeが同じcanonical feature動作を公開する。
- Unit、Playwright、lint、build checkがCIで成功する。

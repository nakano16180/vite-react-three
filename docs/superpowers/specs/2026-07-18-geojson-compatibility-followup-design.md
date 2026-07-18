# GeoJSON互換性レビュー追加対応 設計書

## 目的

PR #36の最新レビューで指摘された、`crypto.randomUUID()`非対応環境でfeatureを保存できない問題と、3D positionを含むGeoJSONをimportできない問題を解消する。

## ID生成

ID生成を共通helperへ分離し、canonical feature作成とGeoJSON importの両方から使用する。

secure contextなどで`crypto.randomUUID()`を利用できる場合は、その値を使用する。APIが存在しない場合は、現在時刻と`Math.random()`から生成した文字列へfallbackする。fallbackはdatabase上の暗号学的識別子を目的とせず、単一client内でfeatureを識別するための値とする。

GeoJSON importでは、入力に空でないIDがあれば従来どおり維持する。IDがない場合または既存IDと重複する場合は、共通helperで未使用IDを生成する。

## 3D GeoJSON position

外部GeoJSONをcanonical geometryへ変換する境界で、各positionの先頭2要素を`[x, y]`として取り出す。3要素目以降の高度や追加ordinateは保存しない。

この正規化はGeoJSON importに限定する。domain modelの`Point2D = [number, number]`と`isFeatureGeometry`の厳密な2D validationは変更しない。

次のpositionは無効として従来どおりfeatureをskipし、warningを返す。

- 要素数が2未満
- `x`または`y`がnumberでない
- `x`または`y`が有限値でない

対象geometryは`LineString`と、現在対応している単一ring・holeなしの`Polygon`とする。

## テスト

テスト駆動で次のcaseを追加する。

- `crypto.randomUUID`が存在しなくても`createGeometryFeature`が空でないIDを生成する。
- `crypto.randomUUID`が存在しなくてもIDなしGeoJSON featureをimportできる。
- 3D `LineString`を2Dへ正規化してimportする。
- 3D `Polygon`を2Dへ正規化し、閉じ点をcanonical形式に合わせて除去する。
- 2要素未満または非数値のpositionを含むgeometryは引き続きskipする。

最終検証では`npm run test`、`npm run lint`、`npm run format:check`、`npm run build`を実行する。

## 対象外

- altitudeをcanonical modelやdatabaseへ保存しない。
- UUID polyfillや新しいdependencyを追加しない。
- GeoJSONで未対応のgeometry typeやPolygon hole対応を追加しない。
- 明示的な許可なしにGitHub review threadへ返信したり、threadをresolveしたりしない。

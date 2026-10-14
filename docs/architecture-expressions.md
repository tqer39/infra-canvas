# インフラ構成図の詳細表現

[architecture.infra](../examples/architecture.infra) で、表示フィルター、往復経路、階層を跨ぐ囲み、接続口、冗長化を確認できます。
開発画面と単一HTMLで同じ機能を利用できます。

## 表示レイヤーと保存ビュー

「表示フィルター」で接続種別・経路・用途を絞り込みます。条件はANDです。
接続種別をすべて外すと線を隠します。ノードと囲みは残ります。
経路・用途の「すべて」はその条件を解除します。
「表示名」と「ビューID」を入力し「ビューを保存」を押すと、条件をモデルとDSLへ保存します。
`label` はタブの表示名です。省略すると従来どおりIDを表示します。
同じビューIDを指定するとそのビューを更新します。リソースと同じIDは使えません。
「DSL を保存」でファイルへ書き出し、再読込後もビューを利用できます。

```text
view application_view label="アプリ通信" level=resource kinds=[traffic,failover] purposes=[application]
view web_path label="Web往復経路" level=resource kinds=[traffic] routes=[web]
```

`kinds`、`routes`、`purposes` は省略時に制限なし、空配列で対象なしです。
ライブラリでは `buildDisplayGraph(diagram, { kinds, routes, purposes })` で上書きできます。
ビューを切り替えると、そのビューの保存条件へ戻します。
未固定ノードは線の絞り込みに伴い自動配置が変わる場合があります。
位置を保つには「配置を移動」で固定してからビューを切り替えてください。

## 順序を持つ往復経路

`route` で経路名、`step` で通過順を指定します。
`routeDirection` は `forward`（省略時）または `return` です。
同じ経路・方向の `step` は1から連続する一意の正整数にし、前の接続先を次の接続元にします。
分岐する経路は別の経路名を使います。

```text
user -> alb route=web step=1 purpose=application
alb -> api route=web step=2 purpose=application
api -> alb route=web step=1 routeDirection=return purpose=application
alb -> user route=web step=2 routeDirection=return purpose=application
```

矢印に経路名・方向・順序を表示します。経路フィルターで一連の線を選べます。
フィルターパネルには元の経路の通過順を表示します。
折りたたみで内部の線を省略しても、元の端点・順序・方向を保持し、展開で復元します。
構成図の明示経路であり、ルートテーブルやSGを評価して通信成立を証明する機能ではありません。

## 階層を跨ぐ囲み

`overlay` は所有階層から独立したメンバーの囲みです。
通常は非表示で、ツールバーの「追加の囲み」で表示を切り替えます。所有階層の枠は常に表示します。
切り替えでカードの位置やズームは変わりません。画面からの書き出しも、この表示状態を反映します。
複数のAZ・Subnet・アカウントの実体をコピーせず、一つのまとまりとして示せます。
同じ実体を複数の囲みに含められます。

```text
overlay application "API の冗長化グループ" members=[api_a,api_c]
overlay backend "バックエンドの信頼境界" members=[api_a,api_c,primary,replica]
```

`members` は実体または境界への空でない一意のID配列です。
囲み自身や別の囲みは参照できず、囲みを接続の端点にはできません。
所属を表す `group` の入れ子とは独立しています。
折りたたむとメンバーの表示上の代表ノードを囲み、詳細表示では範囲内のメンバーだけを囲みます。
囲みはメンバーを包含する矩形です。間にある非メンバーも矩形の内側に入ることがあります。
厳密な所属は `members` で確認してください。非メンバーを避ける多角形の囲みは未対応です。

## 配置の編集と保存

全体表示で「配置を移動」を押し、カードをドラッグして移動します。
移動中は操作案内を表示します。「移動を完了」でドラッグを終了し、「固定を解除」で自動配置に戻せます。
移動完了時に、表示中の各ノードの座標を `x`、`y`、`fixed=true` としてモデルとDSLへ保存します。
親境界内の座標は親に対する相対座標で、親のヘッダーへ重ならないように補正します。
隠れている実体の座標は変更しません。詳細表示では配置編集を無効にします。
「DSL を保存」で書き出すと、再読込後も位置が維持されます。
「固定を解除」で全体を自動配置に戻します。

```text
external.node left x=24 y=100 fixed=true
external.node right x=600 y=100 fixed=true
left -> right
```

`fixed=true` には有限の `x` と `y` が必要です。親境界内の `x` は24以上にしてください。
`y` は24以上に加え、配置時に親のヘッダーより下であることを検証します。
親境界は子を包含する寸法へ拡張します。未固定ノードは固定ノードと重ならないように配置します。
固定済み同士の重なりは自動で解消しません。接続経路を確保できない場合は診断を表示します。
位置固定は座標に適用します。カード寸法の固定・自由な経由点の手動指定は未対応です。

直角線は移動後の端点へ再接続し、他の実体を避けます。
同じ接続口への並行線は別の経路へ分離し、接続しない交差は小さな橋で示します。
直角線のラベルは重なりを避け、線から離れた場合に引き出し線を表示します。
「矢印：直線／曲線」は1クリックで切り替わるトグルです。
曲線は端点間のベジェ曲線で描画します。同一直線上の端点にも膨らみを付けます。
カードを横切る場合は曲がり方を変え、難しい場合は障害物回避経路を丸めます。位置・ズーム・ラベル位置を維持します。
固定した大規模図の経路再計算は追加の計算を伴います。性能保証はありません。

## 接続口と冗長化

`ports` で接続口のIDをリソース内に定義します。
`sourcePort` と `targetPort` で線の接続口を選びます。
接続口は重複しないIDで、接続元・接続先に実在するものを指定してください。
通信の `port=443` などとは独立しています。

```text
external.node api ports=[frontend,backend] redundancyRole=active
external.node spare ports=[frontend,backend] redundancyRole=standby
aws.rds primary redundancyRole=primary
aws.rds replica redundancyRole=replica
api -> primary sourcePort=backend protocol=tcp port=5432
primary -> replica kind=replication label="非同期複製"
api -> spare kind=failover label="切替時"
```

カードに接続口と冗長化の役割を表示し、線のラベルにも指定した接続口を表示します。
接続口は入力側を左、出力側を右に配置します。端点が親境界へ集約される場合は接続口を省略し、展開で復元します。
接続口自身にIP・型・個別属性を持たせるモデルや、上下への配置指定は未対応です。
`redundancyRole` は `primary`、`replica`、`active`、`standby` を使います。
`replication` は複製、`failover` は切替時の関係として、色と凡例で区別します。
切替時の線は破線です。レプリケーション方式や切替条件はラベル・説明に記述してください。
これらは明示した設計意図であり、稼働状態や自動切替の成立を推測しません。

## AZ・リージョンの整列と配置実体

境界に `columnsBy=az` または `columnsBy=region` を指定すると、直属の子を明示属性で整列します。
AZは通信方向と直交する向き、リージョンは列へ並べます。
値がない子は「共有・未指定」へまとめます。左右方向の通信では、共有実体をAZ群の右へ置きます。
値は文字列順、同じグループ内はID順です。属性を親や名前から推測しません。
`availability_zone` は `az` の別名として扱います。固定した直属の子があれば、その境界の列整列を省略します。

```text
zone tokyo "東京" columnsBy=az {
  collection a "AZ A" az="ap-northeast-1a" {
    aws.ec2 api_a logicalService=api
  }
  collection c "AZ C" az="ap-northeast-1c" {
    aws.ec2 api_c logicalService=api
  }
}
external.service api "論理サービス"
```

`logicalService` は別の実体・境界のIDを指定し、配置実体への関連線を表示します。
所有階層は変更せず、実体をコピーしません。参照の自己循環・間接循環を拒否します。
明示した実体間の対応です。クラウドから各AZの実行実体を自動発見する機能ではありません。

## 公開範囲・信頼・暗号化・認証

`exposure` は `public`、`private`、`restricted`、`unknown` を指定します。
カードと境界を公開区分で塗り分け、図上に日本語のラベルを表示します。
既存の `subnetVisibility` / `subnetType` も明示区分の表示に利用します。
`trustZone` は任意の文字列で、信頼ゾーンのラベルと紫色の境界を表示します。
`overlay` にも指定できます。異なるゾーンの名前を同じ色から同一ゾーンと判断しないでください。

```text
aws.ec2 api exposure=private trustZone="本番"
aws.rds database exposure=restricted trustZone="データ"
api -> database encrypted=true authMethod=IAM protocol=tcp port=5432
```

接続の `encrypted=true` / `false` と `authMethod` を矢印のラベルに表示します。
HTTPSという名前だけから暗号化を推測せず、宣言がない項目は表示しません。
実効権限・公開到達性・暗号化の稼働状態の検証は行いません。

## 図上の注釈

`note` は独立した注釈です。表示名と `description` の本文を図上に表示します。
`anchor` は実体・境界のID、`anchorEdge` は接続のIDに引き出し線を付けます。
両者は併用できません。注釈を通信の端点にはできません。

```text
user -> api id=public_api encrypted=true
note premise "通信の前提" anchorEdge=public_api description="設計情報。実測した通信結果ではない。"
note rollout "移行手順" anchor=api description="追加後に負荷分散を確認する。"
```

接続に任意の空でない一意な `id` を指定できます。省略時は従来の `edge-1` などの番号です。
DSLへの書き出しではIDを明示し、並べ替え後も注釈の対応を保ちます。
フィルターで隠れた接続の注釈も隠します。ノードへの注釈は折りたたみ後の代表ノードへ結びます。
注釈も全体表示の対象です。未指定位置はカード・見出し・ラベルを避け、固定座標も指定できます。

## 根拠と変更予定

リソースと接続の `evidence` は `design`、`observed`、`inferred`、`unknown` を使います。
`change` は `unchanged`、`add`、`modify`、`remove` を使います。
根拠と変更状態を図上に表示します。追加は緑、変更は黄、削除は赤の破線で、削除予定の名前には取り消し線を付けます。
Terraformのplan・state・静的読み取りは、保持している出典を別に表示します。
`observed` と記載しても、リアルタイムの稼働状態を取得するわけではありません。
変更状態は明示指定です。Terraformの差分や実効状態から自動で推定しません。

```text
aws.ec2 added evidence=design change=add
aws.ec2 current evidence=observed
aws.ec2 uncertain evidence=unknown
current -> added evidence=design change=add
```

「表示の凡例」から公開区分・根拠・変更予定の意味を確認できます。

## 台数・集合・任意の境界・表示形式

任意のリソースに `count=3` または `countMin=2 countMax=6` を指定し、`×3` / `×2–6` を表示します。
台数は非負の安全な整数です。最小・最大は両方を指定し、最小より小さい最大値を指定しないでください。
固定台数と範囲は併用できません。台数だけから仮想的な実体を生成しません。
集合を展開する場合は `collection` の子として図に必要な実体を明示します。

```text
collection workers "ワーカー群" countMin=2 countMax=6 {
  external.node instance_a
  external.node instance_b
}
onprem.floor office "社内拠点" boundary=true appearance=site {
  rack equipment "ラック" appearance=rack {
    namespace monitoring "監視" appearance=namespace
  }
}
```

`site`、`rack`、`namespace`、`cluster`、`zone`、`collection` は組み込み境界です。
その他の任意種別も `boundary=true` で入れ子・展開・折りたたみ・詳細移動を利用できます。
`appearance` は `default`、`database`、`queue`、`storage`、`rack`、`site`、`namespace` の表示プリセットです。
表示形式はクラウドの実体種別や通信の意味を変更しません。任意の図形・色・フォントの自由指定は未対応です。

## アイコンの指定とクリック

リソースの `icon` に同梱アイコンの種別IDを指定できます。
アカウントに `icon=aws.organization-account` を指定するとAWS公式のアカウントアイコンと「AWS アカウント」を表示します。
明示した `provider=aws` / `aws.alias` でもアカウント用のアイコンを選びます。
名前だけからクラウドを推測しません。未指定の汎用アカウントは従来の代替表示です。

```text
account prod "本番" icon=aws.organization-account
```

右パネルの「表示アイコン」では、クラウド・サービスごとの分類を開閉し、画像から選択できます。
分類名やアイコン名で検索でき、選択はDSLへ自動反映されます。折りたたみと静的出力にも反映します。
外部URLや任意のSVGコードは指定できません。未知の種別IDは代替表示になります。

囲みと引き出し線はクリックを遮りません。接続の選択はラベルのクリック・Tab・Enter・Spaceを使います。
曲線も直線と同じラベル位置を使用し、曲線上の近い位置へ引き出し線を付けます。
ベジェ曲線の制御点を手動で編集する機能は未対応です。

## SVG・PNG・PDFと印刷

上部の「ダウンロード・印刷」で、現在の表示ビュー・固定位置・囲み・注釈・凡例を含むSVG・PNGをダウンロードできます。
出力の線は直角経路です。曲線の表示設定は静的出力には保存しません。
PDFではA4/A3・縦/横・全体を1枚／指定縮尺で分割を選び、印刷画面の「PDFとして保存」を使います。
SVGは外部画像・foreignObject・実行コードを含まず、アイコンも画像データとして埋め込みます。
文字はシステムフォントを使います。SVG/PNGは用紙設定を使わず、図全体を出力します。
PNGの縮尺は25%、50%、100%、150%、200%から選べます。
用紙に全体を合わせる印刷では縮尺を自動調整し、分割印刷では選んだ縮尺を使います。

CLIから実ファイルを直接生成できます。

```bash
npm run build
npx playwright install chromium
node dist/cli.js svg examples/expressions.infra --out artifacts/expressions.svg
node dist/cli.js png examples/expressions.infra --out artifacts/expressions.png --scale 0.5
node dist/cli.js pdf examples/expressions.infra --out artifacts/expressions.pdf --paper A3 --orientation landscape
node dist/cli.js pdf examples/expressions.infra --out artifacts/expressions-tiled.pdf --paper A4 --pages tile --scale 0.5
```

`--view` で保存ビューを選べます。CLIのSVG生成はブラウザ不要です。
PNG/PDFはこのリポジトリのPlaywrightとChromiumを使い、ネットワーク要求を遮断して生成します。
PNGと分割PDFのCLI縮尺は0.1〜2です。PNGは最大辺32767px・1億画素、分割PDFは200ページまでです。
大規模図は縮尺を下げるか、PDFの分割出力を使ってください。

新機能をまとめた [expressions.infra](../examples/expressions.infra) は、上部の「サンプル」からも表示できます。

## 通信方向とAZの並び

`columnsBy=az` の境界では、通信方向が `RIGHT` の場合はAZを上下に、`DOWN` の場合は左右に並べます。
同じAZの実体は通信方向に沿って並べます。リージョンは従来どおり列へ並べます。
直属の子に固定位置がある場合は手動配置を優先します。「固定を解除」で新しい自動配置を適用できます。

境界を選択した場合は、その配下のカードと内部接続も強調対象です。
子を選択した場合は、そのカードと接続先を強調します。その他のカードも読める濃さで表示します。

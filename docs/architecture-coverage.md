# 公開構成図資料の対応確認

2026-10-14に以下の5件の図を目視確認し、主要な境界・サービス・接続をDSLへ再記述しました。
原図の画像は同梱せず、以下の出典へリンクします。原図と同じ座標・装飾・全設定の再現を目的にしていません。
資料の構成を表現できることと、現在のクラウドで構築できることは別です。古い資料を新規構築の推奨とは扱いません。

## 対象と結果

| 出典・対象図                                                                                                                                                                                  | サンプル                                                                           | 確認した表現                                                                                              | 簡略化・残る制約                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AWS公式 Web Application Architecture](https://d1.awsstatic.com/architecture-diagrams/ArchitectureDiagrams/web-application-architecture-on-aws-ra.pdf)、1ページ（2021-11-19）                 | [aws-web.infra](../examples/reference/aws-web.infra)                               | 2AZ、4層Subnet、ALB、EC2、RDS主従、CDN、共有ストレージ、Auto Scalingの関連                                | AZはgroup。AZを跨ぐAuto Scaling枠とDB subnet group枠の重複描画はせず、メンバー関連・リストで示す。NATの通信線や戻り通信は省略                           |
| [Google Cloud公式 Networking for internet-facing application delivery](https://docs.cloud.google.com/architecture/network-application-delivery)、Figure 1（2025-01-13）                       | [gcp-delivery.infra](../examples/reference/gcp-delivery.infra)                     | 複数プロジェクト、2リージョンのFrontend、global VPC、共通Backend、Edgeサービス                            | 原図の無名VM群は代表ノードへ集約。リージョン名・VM数・Subnetを推測しない。Edge枠は論理的なまとめで所有プロジェクトを断定しない                          |
| [Azure公式 Baseline zone-redundant App Service](https://learn.microsoft.com/en-us/azure/architecture/web-apps/app-service/architectures/baseline-zone-redundant)、Architecture図              | [azure-private-link.infra](../examples/reference/azure-private-link.infra)         | 3Subnet、4Private Endpoint、送信インターフェース、VNet外のApp Service、3Zoneの実体、DNSリンク、認証、監視 | 論理的なApp Service枠をgroupで示す。Zoneは実体名に明記。監視をリストへ集約。実効権限・名前解決や到達性の評価はしない                                    |
| [クラスメソッド DevelopersIO CloudFront VPC Origin WebSocket](https://dev.classmethod.jp/articles/amazon-cloudfront-websockets-vpc-origins/)、検証環境図（2026-05-25）とリンク先CDKの構成説明 | [classmethod-websocket.infra](../examples/reference/classmethod-websocket.infra)   | private Subnet2つに跨るInternal ALB、単一Fargate Task、Endpoint群、WebSocket経路                          | IGWはアタッチだけを関連線にし、通信ホップとみなさない。Endpoint個別のENI、SG、ヘッダー、タイムアウトを省略                                              |
| [サーバーワークス AWS Network FirewallとTGW](https://blog.serverworks.co.jp/aws-network-firewall-and-transit-gateway)、Centralized Inspection at Inspection VPC図（2021-05-25）               | [serverworks-inspection.infra](../examples/reference/serverworks-inspection.infra) | 5VPC、共有TGW、検査前後の逆方向接続、Ingress/Egress/East-West、TGW経路表                                  | 2AZをサービス単位へ集約。Subnet経路表は省略。経路番号は資料の経路説明を元に付与。図に全経路を同時に置くため、個々のパケット追跡には経路ごとの選択が必要 |

未知のサービス種別も型名・表示名を持つカードで保持します。今回の資料にある全サービスの公式アイコンはまだ同梱していません。
対応アイコンの追加と、資料の通信成立・構築妥当性の自動検証は別の作業です。

## 見つかった不足と拡張

経路表やEndpoint一覧が詳細パネルにしか出せず、図全体を見た際に意図が伝わりにくい状態でした。
`display=table` / `display=list` を追加し、任意のサービスカードへテキスト表・リストを表示できるようにしました。
文字列の折り返し高さをELKへ渡し、親境界の内側にカードを配置します。DSL・外部JSONで形式を検証し、単一HTMLにも含めます。

既存の一意ID、入れ子、subnetsの複数参照、関連線、逆方向の独立した線で、今回の主要な関係を表現できました。
重複する境界の囲み、ポート単位の接続、厳密な経路順序モデル、経路別の表示レイヤーは未対応です。
`group`の入れ子は排他的な所属です。重複する所属は複数の関連線で示し、実体をコピーしません。
曲線・アニメーション・LLM対話編集は、この資料検証では追加していません。

## 再現方法と検証条件

```bash
npm run cli -- validate examples/reference/serverworks-inspection.infra
npm run cli -- html examples/reference/serverworks-inspection.infra --out artifacts/reference.html
npm run check
mise run lint
npm run test:browser
```

すべてのサンプルについて、DSLと外部JSONの検証、DSL往復、階層内への配置、折りたたみから元の接続への復元を自動検証します。
ブラウザでは5件それぞれを単一HTMLとして出力し、オフラインで読み込み、表・リストのはみ出しと、一括折りたたみ・全体表示後の「＋」での展開を確認します。
スクリーンショットは `artifacts/reference-*.png` に生成します。
表のセルは文字列で、ターゲット欄からリソース参照・経路を自動生成しません。

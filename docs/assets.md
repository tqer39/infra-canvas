# 公式アイコンと参照資料

取得日は2026年10月13日です。`src/assets/manifest.json` に元パスと SHA-256 を記録しています。
アイコンはサービス識別用です。各社の商標・アイコンの権利は各社に帰属します。
元の形状と配色を保ち、縮尺を保って表示します。

## 配布物

| ベンダー | 版と取得元 | 配布 ZIP の SHA-256 |
| --- | --- | --- |
| AWS | [公式ページ](https://aws.amazon.com/architecture/icons/) の Icon package、2026-07-31 | `d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526` |
| Google Cloud | [公式ページ](https://cloud.google.com/icons) の Core product icons、取得日時点 | `6531a10f58bc599c24d9a455d81dd757c1a03c3c43da9cddf639b859c1c1eece` |
| Azure | [公式ページ](https://learn.microsoft.com/en-us/azure/architecture/icons/) の Azure_Public_Service_Icons_V24 | `921594ccd1bf3d9c0a1bd7b6d924e050551a59342f2b353bb74bdcf761c35141` |

AWS は公式ページで構成図・資料への利用を許容しています。代表サービスの元 SVG を同梱します。
Microsoft は構成図・教育資料・文書の用途に限った複製、配布、表示を許容し、切り抜き・反転・変形を禁止しています。
Google Cloud は公式ライブラリで構成図・技術文書用として提供しています。
[配布ガイド](https://services.google.com/fh/files/misc/google-cloud-product-icons.pdf) は2026年5月更新です。
Google の ZIP に独立した OSS ライセンスや版番号はありません。汎用素材として再配布する権利は主張しません。
同梱はこの構成図表示の用途に限定します。別用途への転用は提供元の条件を確認してください。

`src/assets/icons.ts` の型名と資産の対応表は拡張できます。
AWS ALB は Elastic Load Balancing アイコンです。未対応の種別は代替記号と種別名を表示します。

## 仕様の確認先

- [React Flow の Sub Flows](https://reactflow.dev/learn/layouting/sub-flows)：親 ID、相対座標、親を先に並べる規則。
- [ELK.js](https://github.com/kieler/elkjs)：compound graph と自動配置。版は lockfile に固定しています。
- [AWS Subnets](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)：Subnet は単一 AZ、Public は Internet Gateway へのルートが根拠です。
- [Google Cloud VPC](https://cloud.google.com/vpc/docs/vpc)：VPC は global、Subnet は regional です。
- [Azure Virtual Network](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview)：Virtual Network のスコープと Subnet の扱い。

DSL は図の宣言です。これらの制約を全面的に検証するクラウド設計検証器ではありません。

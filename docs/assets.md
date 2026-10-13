# アイコンと参照資料

初回取得日は2026年10月13日です。最新版の取得日・配布元はマニフェストを参照してください。`src/assets/manifest.json` に元パスと SHA-256 を記録しています。
アイコンはサービス識別用です。各社の商標・アイコンの権利は各社に帰属します。
元の形状と配色を保ち、縮尺を保って表示します。

## 初回のクラウド配布物

| ベンダー     | 版と取得元                                                                                                  | 配布 ZIP の SHA-256                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| AWS          | [公式ページ](https://aws.amazon.com/architecture/icons/) の Icon package、2026-07-31                        | `d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526` |
| Google Cloud | [公式ページ](https://cloud.google.com/icons) の Core product icons、取得日時点                              | `6531a10f58bc599c24d9a455d81dd757c1a03c3c43da9cddf639b859c1c1eece` |
| Azure        | [公式ページ](https://learn.microsoft.com/en-us/azure/architecture/icons/) の Azure_Public_Service_Icons_V24 | `921594ccd1bf3d9c0a1bd7b6d924e050551a59342f2b353bb74bdcf761c35141` |

AWS は公式ページで構成図・資料への利用を許容しています。代表サービスの元 SVG を同梱します。
Microsoft は構成図・教育資料・文書の用途に限った複製、配布、表示を許容し、切り抜き・反転・変形を禁止しています。
Google Cloud は公式ライブラリで構成図・技術文書用として提供しています。
[配布ガイド](https://services.google.com/fh/files/misc/google-cloud-product-icons.pdf) は2026年5月更新です。
Google の ZIP に独立した OSS ライセンスや版番号はありません。汎用素材として再配布する権利は主張しません。
同梱はこの構成図表示の用途に限定します。別用途への転用は提供元の条件を確認してください。

`src/assets/icons.ts` の型名と資産の対応表は拡張できます。
AWS ALB は Elastic Load Balancing アイコンです。未対応の種別は代替記号と種別名を表示します。

`external.user`（利用者）は、人の頭と肩を表した独自 SVG を表示します。
Infra Canvas の色に合わせて作成した素材で、外部ライブラリやブランド素材への依存はありません。
単一 HTML にも埋め込みます。マニフェストのハッシュで同梱資産を検証します。

## SaaS・IaaS のサービスアイコン

指定された9サービスをローカル SVG として同梱しています。外部 CDN や認証情報は不要です。
単一 HTML にも埋め込みます。対応する型は次のとおりです。

| サービス      | DSL の型                                             | 配布元・利用条件                                                                                  |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GitHub        | `saas.github`、`github.repository`、`github.actions` | [公式ブランドキット](https://brand.github.com/foundations/logo) の Invertocat Black               |
| 1Password     | `saas.1password`                                     | Simple Icons（版はマニフェスト参照）。[公式メディアキット](https://1password.com/press)           |
| Linear        | `saas.linear`                                        | [公式ブランドキット](https://linear.app/brand) の logo-dark.svg                                   |
| GitLab        | `saas.gitlab`、`gitlab.repository`、`gitlab.ci`      | [公式プレスキット](https://about.gitlab.com/press/press-kit/) の RGB logomark                     |
| Neon          | `saas.neon`                                          | [公式ブランドキット](https://neon.com/brand) のカラー logomark                                    |
| Fly.io        | `saas.fly`                                           | [公式ブランドキット・利用条件](https://docs.fly.io/about/brand) の Dark Brandmark                 |
| Resend        | `saas.resend`                                        | [公式ブランドキット](https://resend.com/brand) の Black icon                                      |
| Elasticsearch | `saas.elasticsearch`                                 | Simple Icons（版はマニフェスト参照）。[Elastic 商標規約](https://www.elastic.co/legal/trademarks) |
| Kibana        | `saas.kibana`                                        | Simple Icons（版はマニフェスト参照）。[Elastic 商標規約](https://www.elastic.co/legal/trademarks) |

公式6サービスの SVG は取得したファイルを変更せずに保存しています。
1Password・Elasticsearch・Kibana は [Simple Icons](https://github.com/simple-icons/simple-icons) が提供する
SVG に同じ固定版のブランドカラー（`hex`）を適用したものです。形状は維持します。
各社公式から直接取得した資産ではありません。原本と着色後のハッシュ・カラーの出典を記録しています。
同コレクションの CC0 ライセンスと免責事項を `src/assets/SIMPLE-ICONS-LICENSE.txt`、
`src/assets/SIMPLE-ICONS-DISCLAIMER.txt` に同梱しています。
CC0 は各社の商標利用の許諾を意味しません。各ブランドの権利と利用条件は別途適用されます。

構成図でサービスを識別する用途に限定し、Infra Canvas 自体のロゴや提携・承認の表示に使いません。
Linear・Neon・Resend は配布ファイルの変更を禁じています。形状・色の変更を行いません。
Fly.io の条件は書面による利用許可を要求しています。公開資料などで使う前に提供元の条件を確認してください。
Fly.io のカードのアイコンと名前には、条件に従って公式ホームページへのリンクを付けています。
このリンクは利用者がクリックするまで通信しません。

取得 URL、版、取得日、ファイルの SHA-256、ZIP 内のパスと ZIP の SHA-256 は
`src/assets/manifest.json` に記録しています。版番号のない公式資産は取得日とハッシュで識別します。
更新時はブランドガイドと差分を確認し、マニフェストも更新してください。
ラベルからの推測ではなく型名で対応付けます。未知のサービスは従来どおり代替表示になります。
9サービスを含む実例は [saas.infra](../examples/saas.infra) です。

## 追加カタログ

[主要サービスのアイコン一覧](service-icons.md) に追加34種と、日本のサービスを含む公開カタログをまとめています。
既存9種と合わせ43種に対応しています。

## 仕様の確認先

- [React Flow の Sub Flows](https://reactflow.dev/learn/layouting/sub-flows)：親 ID、相対座標、親を先に並べる規則。
- [ELK.js](https://github.com/kieler/elkjs)：compound graph と自動配置。版は lockfile に固定しています。
- [AWS Subnets](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)：Subnet は単一 AZ、Public は Internet Gateway へのルートが根拠です。
- [Google Cloud VPC](https://cloud.google.com/vpc/docs/vpc)：VPC は global、Subnet は regional です。
- [Azure Virtual Network](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview)：Virtual Network のスコープと Subnet の扱い。

DSL は図の宣言です。これらの制約を全面的に検証するクラウド設計検証器ではありません。

## 月次の自動更新

`.github/workflows/update-icons.yml` は毎月1日09:17 JSTに実行します。
GitHub のスケジュール実行は既定ブランチへのマージ後に有効となり、実行時刻に遅延が生じる場合があります。
Actions の「Update icons」から手動実行もできます。`dry_run` は既定で有効です。

同梱済みのサービスと国旗を更新します。未対応サービスの自動追加やリージョン対応表の変更はしません。
AWS・Google Cloud・Azure の公式ページから最新 ZIP のリンクを解決し、公式6サービスは記録した配布URLを確認します。
Simple Icons・flag-icons は npm の最新安定版を取得し、レジストリの integrity を確認します。
Simple Icons は同じ配布物の slug と hex で形状とブランドカラーを適用します。
ライセンス・免責事項・出典・版・SHA-256 も更新します。独自の利用者アイコンは保持します。
全取得・SVG検証が成功してから書き込むため、取得失敗やブランド削除・曖昧なパスでは部分的な更新を適用しません。
変更がない場合、取得日だけの差分や新しいPRを作りません。

型検査・lint・単体テスト・更新処理の回帰テスト・ビルド・通常画面とオフラインHTMLのブラウザーテストを実行します。
検証後に専用の `codex/update-icons` ブランチと更新PRを作成し、同じ内容の既存PRは更新しません。
このブランチは自動処理専用です。人の変更は別ブランチで行ってください。
PR は自動マージしません。ブランド利用条件と見た目の差分を確認してマージすると、ライブラリと単一HTMLに反映されます。
App が作成したPRでは通常のPR CIも実行されます。

ローカルでは Python 3 と curl が必要です。外部パッケージをインストール・実行せずに配布物を読み取ります。

```bash
npm run icons:check  # 取得・検証・差分一覧だけ（書き込まない）
npm run icons:update
npm run fmt
npm run check
npm run test:browser
```

### GitHub App と1Passwordの初期設定

専用 App `infra-canvas-icon-updater` は private、Webhook無効で登録します。
Repository permissions は Contents と Pull requests の Read and write、Metadata の Read-onlyだけです。
インストール対象は `tqer39/infra-canvas` だけに限定します。
1Password の `infra-canvas` Vault に `Icon Update GitHub App` を作成し、`client_id` と `private_key` を保存します。
ワークフローは公式 `1Password/load-secrets-action` と `actions/create-github-app-token` を固定SHAで使い、
このリポジトリと必要な権限だけに限定した短期トークンを発行します。

Vaultを読み取り可能な1Passwordサービスアカウントを作成し、そのトークンを
リポジトリのActions secret `OP_SERVICE_ACCOUNT_TOKEN` に設定します。秘密鍵自体はGitHubに保存しません。
シークレット値はログ・ソース・PR本文に出力しないでください。
初期設定後に `dry_run=false` で手動実行し、更新PRとCIを確認します。

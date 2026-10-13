# Infra Canvas

独自 DSL と Terraform から対話型のインフラ構成図を生成します。
構成モデルは React から独立した TypeScript ライブラリです。
React Flow が探索操作を、ELK.js が境界を含む自動配置を担当します。

## 起動

Node.js 24 以上を使います。

```bash
npm ci --ignore-scripts
npm run build
npm run dev
```

表示先は `http://127.0.0.1:5178/` です。終了はターミナルで `Ctrl+C` を押します。
サンプルから始まり、上部の「DSL を編集」で任意の入力を解析できます。
「ファイルを開く」から `.infra` または取り込み済みのモデル JSON を選べます。
Terraform の生の JSON は CLI で取り込んでください。

概要・サービス・ネットワーク・セキュリティを切り替えられます。
境界の `−` / `+` で折りたたみ・展開できます。選択詳細の「詳細へ移動」は境界内に絞ります。
検索は対象へ移動し、必要な祖先を展開します。ホバーは関連を強調し、クリックは強調を固定します。
余白のクリックで固定を解除します。パン・ズーム・全体表示・ミニマップから広い図を探索できます。

## CLI

```bash
mkdir -p artifacts
node dist/cli.js validate examples/aws.infra
node dist/cli.js preview examples/aws.infra --port 5180
node dist/cli.js html examples/aws.infra --out artifacts/aws.html
node dist/cli.js import examples/terraform --json fixture-plan.json --out artifacts/terraform-model.json --dsl artifacts/terraform.infra
node dist/cli.js preview artifacts/terraform-model.json --port 5181
node dist/cli.js dsl artifacts/terraform-model.json --out artifacts/terraform.infra
```

`npm run cli -- ...` も利用できます。
HTML は JavaScript・CSS・アイコンを同梱した単一ファイルで、直接開いてオフラインで操作できます。
横ホイールと Shift＋縦ホイールで左右にパンし、通常の縦ホイールでズームします。
矢印のラベルはクリックまたは Tab でフォーカスでき、Enter／Space でも選択できます。
選択した接続の種類・属性・接続元／先・集約前の接続を右パネルで確認できます。
外部 CDN や開発サーバーへの接続は不要です。
モデル JSON、DSL、HTML の構成情報は閲覧者に見えます。共有前に内容を確認してください。

実リポジトリでは root を明示し、既存の認証手順で生成した `terraform show -json` を使います。
CLI は Terraform を実行せず、ローカルのファイルを読み取ります。
詳しい操作と対応範囲は [Terraform 取り込み](docs/terraform.md) に記載しています。

## 公開 API

```typescript
import { parseDSL, buildDisplayGraph, layoutGraph, serializeDSL } from 'infra-canvas';
import { importTerraformRepository } from 'infra-canvas/terraform';

const result = parseDSL(source);
if (result.diagram) {
  const graph = buildDisplayGraph(result.diagram, { view: 'network', collapsed: [] });
  const layout = await layoutGraph(graph, { direction: 'RIGHT' });
  console.log(layout.nodes.length);
  const dsl = serializeDSL(result.diagram);
}
const model = await importTerraformRepository({ repository: './terraform-repo', root: 'production', json: '/tmp/plan.json' });
```

npm 公開はしていません。ビルド後、ローカルのパス依存として使用できます。
`parseDSL` は行・列付きの診断を返します。DSL の正しさとクラウド構成の実現可能性は区別します。
構成モデル、表示の集約、配置座標は別々の API です。

## サンプルと仕様

| 入力                                          | 内容                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| [aws.infra](examples/aws.infra)               | AWS 2 アカウント、2 AZ、ALB・ECS・RDS、重複 SG、GitHub Actions・OIDC           |
| [gcp-azure.infra](examples/gcp-azure.infra)   | Google Cloud と Azure の小規模構成                                             |
| [multicloud.infra](examples/multicloud.infra) | 複数クラウドと外部サービス                                                     |
| [saas.infra](examples/saas.infra)             | GitHub・1Password・Linear・GitLab・Neon・Fly.io・Resend・Elasticsearch・Kibana |
| [large.infra](examples/large.infra)           | 300 サービスと18境界                                                           |
| [terraform](examples/terraform)               | module、count、for_each、複数 provider、未確定値を含む合成入力                 |

[DSL 仕様](docs/dsl.md) に LLM 向け生成指示、例、修正例を用意しています。
[アイコンと一次資料](docs/assets.md) に取得元、版、利用条件を記録しています。
[主要サービス43種の一覧](docs/service-icons.md) と [カタログ入力](examples/service-catalog.infra) も用意しています。
[検証結果](docs/verification.md) にブラウザ操作、配置計測、制約を記録しています。

## 検証

コードの検査は Oxlint、整形は Oxfmt、型検査は `tsc --noEmit`、文書規約の検査は markdownlint を使います。
`npm run fmt` で整形し、`npm run fmt:check` は書き換えず差分を検査します。
独自 DSL・Terraform のサンプル、公式 SVG・資産 manifest、生成物、lockfile は整形対象から除外します。
Markdown 内のサンプルコードも自動整形しません。

```bash
npm run check
mise run lint
npx playwright install chromium
npm run test:browser
```

CI は同じ型検査・lint・整形チェック・回帰テスト・ビルド・ブラウザテストを実行します。
読み取り権限だけを持ち、シークレットを必要としません。
将来シークレット設定が必要になった場合は、kazokubi の運用を参照し、1Password から取得します。
値をコード、モデル、ログへ出力する手順は使用しません。

## 初期版の範囲と制約

AWS・Google Cloud・Azure・GitHub・外部サービスを DSL で記述できます。
代表クラウドサービスは公式アイコン、SaaS は公式配布素材または Simple Icons の固定版を表示します。未知の種別は種別名を含む代替表示になります。
Terraform は AWS を優先します。plan/state の実体は保持しますが、アカウントを provider alias から推定しません。
SG は重複可能な関連であり、許可規則だけで通信成立を判断しません。
参照や `depends_on` は依存関係として描画します。

Google Cloud・Azure の Terraform、HCL の全面的な式評価、外部 module の取得、SG ルールの到達性検証、
配置保存・固定、セマンティックズーム、LLM API、ホスティング、npm 公開は未対応です。
同じ入力と配置版での再現性は検証します。少量の変更で配置を維持する安定性は保証しません。

リポジトリ設定は [terraform-github](https://github.com/tqer39/terraform-github) が管理します。

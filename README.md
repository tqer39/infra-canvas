# Infra Canvas

独自 DSL と Terraform から対話型のインフラ構成図を生成します。
構成モデルは React から独立した TypeScript ライブラリです。
React Flow が探索操作を、ELK.js が境界を含む自動配置を担当します。

## 起動

mise を導入し、リポジトリを clone したディレクトリで実行します。Node.js 24.21.0 と Python 3.14.7 は mise が管理します。

```bash
mise bootstrap
mise run dev
```

セットアップは依存インストール、AIルール生成、headless Chromium の準備、ビルドを行い、再実行できます。
Linux で Chromium の OS 依存が不足する場合は `mise run browser:install-ci` を使います。
macOS・Linux・Windows の共通入口は mise です（動作実測は macOS）。

表示先は `http://127.0.0.1:5178/` です。終了はターミナルで `Ctrl+C` を押します。
サンプルから始まり、上部の「DSL を編集」で任意の入力を解析できます。
「ファイルを開く」から `.infra` または取り込み済みのモデル JSON を選べます。
Terraform の生の JSON は CLI で取り込んでください。

要素を選択すると、右ペインで名前と属性を直接編集できます。
CPU は units、メモリは MiB、配列は1行に1項目で入力し、「変更を反映」で図と DSL に反映します。
属性の追加・削除と、接続の種類・ポート・送信データなどの編集も可能です。
不正な数値や存在しない参照は反映せず、現在の図を保持します。
Terraform 由来の要素を編集すると設計値として扱い、元の Terraform には書き戻しません。
変更はブラウザー内で保持します。再読み込み前に DSL エディターの内容を保存してください。

概要・サービス・ネットワーク・セキュリティを切り替えられます。
境界の `−` / `+` で折りたたみ・展開できます。選択詳細の「詳細へ移動」は境界内に絞ります。
検索は対象へ移動し、必要な祖先を展開します。未選択時は全体をカラー表示し、ホバーは関連線を強調します。
クリックは強調を固定し、無関係な要素を薄くします。「選択を解除」または余白のクリックで全体のカラーに戻ります。
選択解除はパン・ズームを維持します。パン・ズーム・全体表示・ミニマップから広い図を探索できます。
「すべて折りたたむ」「すべて展開する」で、現在の表示範囲の境界を入れ子も含め一括操作できます。
概要表示でもすべて展開でき、詳細へ移動した状態ではその範囲だけを操作します。パン・ズームは維持します。
`region` 属性を持つ境界やサービスには、対応する国・地域の国旗を表示します（[対応範囲と出典](docs/regions.md)）。

アカウントID・リージョン・AZ・AZ ID・CIDRなどの明示属性は、名前の下に表示します。
展開・折りたたみの両方で確認でき、IDの先頭ゼロを保持します（[表示例](examples/identity.infra)）。

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

`mise run cli -- ...` も利用できます。
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

[公開構成図5件の対応確認](docs/architecture-coverage.md) と [再記述サンプル](examples/reference) では、3クラウド公式・クラスメソッド・サーバーワークスの図を検証しています。

[DSL 仕様](docs/dsl.md) に LLM 向け生成指示、例、修正例を用意しています。
[アイコンと一次資料](docs/assets.md) に取得元、版、利用条件を記録しています。
[主要サービス43種の一覧](docs/service-icons.md) と [カタログ入力](examples/service-catalog.infra) も用意しています。
[検証結果](docs/verification.md) にブラウザ操作、配置計測、制約を記録しています。

## 検証

コードの検査は Oxlint、整形は Oxfmt、型検査は `tsc --noEmit`、文書規約の検査は markdownlint を使います。
`mise run fmt` で整形し、`mise run fmt:check` は書き換えず差分を検査します。
独自 DSL・Terraform のサンプル、公式 SVG・資産 manifest、生成物、lockfile は整形対象から除外します。
Markdown 内のサンプルコードも自動整形しません。

```bash
mise run check
mise run lint
npx playwright install chromium
mise run test:browser
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

## AI 開発ルール

共通ルールは `.rulesync/rules/overview.md` にまとめています。
`mise run rules:generate` で Codex、Claude Code、Copilot、Cursor 向けに rulesync 33.0.0 から生成し、
Gemini CLI 向けの `GEMINI.md` には共通の `AGENTS.md` と同じ内容を同期します。
現行 rulesync に Gemini CLI 専用ターゲットがないため、この同期を mise タスクで補っています。
`mise run rules:check` で差分を検出し、`mise run check` と CI でも検証します。
生成ファイルは直接編集せず、正本を更新してから生成してください。権限・MCP・認証設定は生成しません。

実行コマンドは `mise.toml` が正本で、npm scripts は互換入口です。
ビルド・アイコン収集など、まとまった処理の実装は既存スクリプトを保ち、mise から呼び出します。
公開用の Bash 処理は GitHub Actions の Linux 専用です。

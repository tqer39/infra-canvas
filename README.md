# Infra Canvas

独自 DSL と Terraform から対話型のインフラ構成図を生成します。
構成モデルは React から独立した TypeScript ライブラリです。
React Flow が探索操作を、ELK.js が境界を含む自動配置を担当します。

本体は [MIT License](LICENSE) です。商用利用も可能です。
同梱アイコンなどには提供元の別条件が適用されます。
[第三者素材の条件](THIRD_PARTY_NOTICES.md) と [ライセンス方針](docs/licensing.md) を確認してください。
公開準備の変更と未完了の確認事項は [監査記録](docs/publication-audit.md) にまとめています。

## クイックスタート（Docker）

Docker が動作する環境で実行します。clone・mise・Node.js のインストールは不要です。
イメージは `linux/arm64`（Apple Silicon など）と `linux/amd64` に対応し、CPU に合うものが選択されます。
初回は下記の配布ワークフローによる安定版の公開後に利用できます。

```bash
docker run --rm --name infra-canvas -p 127.0.0.1:5180:5180 ghcr.io/tqer39/infra-canvas:latest
```

ブラウザーで `http://127.0.0.1:5180/` を開くと AWS サンプルを表示します。終了は `Ctrl+C` です。
「ファイルを開く」で手元の `.infra`・取り込み済みモデル JSON を読み込み、図や属性を編集できます。
編集結果は「DSL を保存」でホストへダウンロードしてください。コンテナーを削除してもダウンロードしたファイルは残ります。
コンテナーのファイルシステムへの変更は `--rm` により削除されます。

公開先は端末内だけに限定しています。コンテナー内部は `0.0.0.0` で待ち受けますが、
ホスト側の `-p 127.0.0.1:5180:5180` を維持してください。認証付きの共有サーバー用途には対応していません。
5180 が使用中なら `-p 127.0.0.1:5181:5180` とし、ブラウザーでは 5181 を開きます。
バージョンを固定する場合は `:latest` を `:0.1.0` などの公開済みタグに置き換えてください。
`latest` を更新する場合は、起動前に `docker pull ghcr.io/tqer39/infra-canvas:latest` を実行します。

Docker 版はブラウザーでの図の編集・保存・SVG/PNG出力・印刷と、CLI の validate・import・dsl・html・svg に対応します。
CLI の png/pdf 用の headless Chromium は同梱しません。CLI での実行が必要な場合は開発環境を使用してください。
単一 HTML のオフライン利用も引き続き可能です。

ホストの GitHub CLI 認証・AWS プロファイル・OS の資格情報ストアは自動では引き継ぎません。
GitHub の公開リポジトリは取得でき、非公開リポジトリは画面内の読み取り用トークン欄を使用できます。
ブラウザー内 LLM は対応ブラウザーと WebGPU が必要で、初回はモデルを取得します。
外部 LLM の API キーを画面から永続保存する機能は Docker 版の対象外です。
環境変数での外部 LLM 接続は `--env-file` で設定できますが、キーをイメージへ含めないでください。
設定例は [.env.example](.env.example) を参照してください。
コンテナー内の `localhost` はホストとは別なので、ホスト上の LLM への接続は追加のネットワーク設定が必要です。

### 手元のファイルを起動時に指定する

カレントディレクトリを読み取り専用でマウントします（PowerShell では `$(pwd)` を `${PWD}` に置き換えます）。

```bash
docker run --rm -p 127.0.0.1:5180:5180 --mount "type=bind,source=$(pwd),target=/data,readonly" ghcr.io/tqer39/infra-canvas:latest preview /data/example.infra --host 0.0.0.0 --port 5180
```

### Docker イメージのビルド・検証・配布

リポジトリ内では `mise run docker:build` で `infra-canvas:local` をビルドできます。
`mise run install` と `mise run browser:install` の後、`mise run test:docker` で
起動・非 root 実行・API の Host/Origin 保護・図の編集・DSL 保存/読み込み・healthcheck を検証します。
別アーキテクチャも実行できる Docker 環境では、次のように両方をローカル検証できます。

```bash
docker buildx build --platform linux/arm64 --load -t infra-canvas:arm64 .
mise run test:docker -- infra-canvas:arm64 linux/arm64
docker buildx build --platform linux/amd64 --load -t infra-canvas:amd64 .
mise run test:docker -- infra-canvas:amd64 linux/amd64
```

[Docker ワークフロー](.github/workflows/docker.yml) は PR・main の push・手動実行で、
Ubuntu Server 上の専用 VM に置いた self-hosted runner で、両 CPU のイメージをビルドしブラウザー操作まで検証します。
amd64 はネイティブ、arm64 は QEMU/binfmt による互換実行です。通常 CI の runner とホストの Docker は使用しません。
構築・運用方法は [Docker runner](docs/docker-runner.md) を参照してください。
`v0.1.0` などのバージョンタグを push すると、両 CPU の検証成功後に
`ghcr.io/tqer39/infra-canvas:0.1.0` を配布します。安定版は `latest` も更新し、プレリリースは更新しません。
GHCR への書き込みは公開ジョブだけに付与し、認証には `GITHUB_TOKEN` を使います。追加の PAT は不要です。
初回の公開後、管理者が GHCR パッケージの可視性を Public に設定すると、ログインなしで取得できます。
ワークフローは可視性やリポジトリのアクセス設定を変更しません。

## 開発環境での起動

mise を導入し、リポジトリを clone したディレクトリで実行します。Node.js 24.21.0、Python 3.14.7、Lefthook 2.2.1 は mise が管理します。

```bash
mise bootstrap
mise run dev
```

セットアップは依存インストール、Git フック登録、AIルール生成、headless Chromium の準備、ビルドを行い、再実行できます。
Linux で Chromium の OS 依存が不足する場合は `mise run browser:install-ci` を使います。
macOS・Linux・Windows の共通入口は mise です（動作実測は macOS）。

表示先は `http://127.0.0.1:5178/` です。終了はターミナルで `Ctrl+C` を押します。
サンプルから始まり、上部の「DSL を編集」で任意の入力を解析できます。
「ファイルを開く」から `.infra` または取り込み済みのモデル JSON を選べます。
Terraform の生の JSON は CLI で取り込んでください。

要素を選択すると、右ペインで名前と属性を直接編集できます。
CPU は units、メモリは MiB、配列は1行に1項目で入力します。
右ペインの選択項目は選択時、テキスト・数値・配列は入力欄を離れた時に図と DSL へ自動反映します。
表示アイコンは検索で絞り込んで選択でき、取り消しには「元に戻す」を使います。
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
「元に戻す」「やり直す」で、属性編集・DSL の反映・ファイル読み込み・表示切り替え・境界操作・詳細への移動・矢印形状の変更を戻せます。
履歴は画面を開いている間の最大100操作で、Undo 後の新しい操作で Redo を破棄します。選択・パン・ズーム・入力途中の文字編集は図の履歴に含めません。
入力欄以外では `Ctrl / ⌘ + Z` で Undo、`Ctrl / ⌘ + Shift + Z` または `Ctrl + Y` で Redo を実行できます。
入力欄ではブラウザ標準の文字編集の Undo/Redo を使います。DSL やファイルの変更を戻すと、入力欄も反映済みの内容に復元します。
`region` 属性を持つ境界やサービスには、対応する国・地域の国旗を表示します（[対応範囲と出典](docs/regions.md)）。

アカウントID・リージョン・AZ・AZ ID・CIDRなどの明示属性は、名前の下に表示します。
展開・折りたたみの両方で確認でき、IDの先頭ゼロを保持します（[表示例](examples/identity.infra)）。

表示フィルター・往復経路・跨る囲み・配置保存・接続口・冗長化の操作は
[詳細表現](docs/architecture-expressions.md) と [サンプル](examples/architecture.infra) を参照してください。
「DSL を保存」でビューと固定位置を含む入力をダウンロードできます。
上部の「サンプル」でP2・P3の表現一覧を表示し、「ダウンロード・印刷」からSVG・PNG・印刷用PDFを生成できます。
AZ・リージョンの列、公開範囲・信頼、注釈、根拠・変更予定、台数・集合、任意の境界と表示形式も利用できます。

## CLI

```bash
mkdir -p artifacts
node dist/cli.js validate examples/aws.infra
node dist/cli.js preview examples/aws.infra --port 5180
node dist/cli.js html examples/aws.infra --out artifacts/aws.html
node dist/cli.js svg examples/expressions.infra --out artifacts/expressions.svg
node dist/cli.js pdf examples/expressions.infra --out artifacts/expressions.pdf --paper A3
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

| 入力                                                    | 内容                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [aws.infra](examples/aws.infra)                         | AWS 2 アカウント、2 AZ、ALB・ECS・RDS、重複 SG、GitHub Actions・OIDC           |
| [gcp-azure.infra](examples/gcp-azure.infra)             | Google Cloud と Azure の小規模構成                                             |
| [gcp-web.infra](examples/gcp-web.infra)                 | Google Cloud: Cloud Run・Cloud SQL・Cloud Storage と実行サービスアカウント     |
| [gcp-analytics.infra](examples/gcp-analytics.infra)     | Google Cloud: Pub/Sub から BigQuery subscription によるイベント分析            |
| [azure-web.infra](examples/azure-web.infra)             | Azure: App Service・SQL Database・Blob Storage とマネージドID                  |
| [azure-functions.infra](examples/azure-functions.infra) | Azure: Blob アップロードを契機に Functions で画像を変換・保存                  |
| [multicloud.infra](examples/multicloud.infra)           | 複数クラウドと外部サービス                                                     |
| [saas.infra](examples/saas.infra)                       | GitHub・1Password・Linear・GitLab・Neon・Fly.io・Resend・Elasticsearch・Kibana |
| [large.infra](examples/large.infra)                     | 300 サービスと18境界                                                           |
| [terraform](examples/terraform)                         | module、count、for_each、複数 provider、未確定値を含む合成入力                 |

追加した4件は架空の設計例です。「ファイルを開く」で読み込むか、
`node dist/cli.js preview examples/gcp-web.infra --port 5180` のように表示できます。
概要・サービス・ネットワーク・セキュリティの4ビューで、通信・認可・配備の関係を確認できます。
各サービスの接続設定・権限・通信成立を検証するものではありません。
未対応アイコンのサービスも種別名付きで表示します。

構成の根拠は [Cloud Run と Cloud SQL の接続](https://docs.cloud.google.com/sql/docs/postgres/connect-run)、
[BigQuery subscription](https://docs.cloud.google.com/pubsub/docs/bigquery)、
[App Service のマネージドIDによるSQL接続](https://learn.microsoft.com/en-us/azure/app-service/tutorial-connect-msi-sql-database)、
[Functions の Blob trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob-trigger) と
[Blob 出力binding](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob-output) です。

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

Lefthook の `pre-commit` は `mise run lint` と `mise run rules:check` を並列に実行し、
失敗するとコミットを止めます。ステージ済みファイルに限定せず、作業ツリー全体を検証します。
自動修正や再ステージは行わないため、整形エラーは `mise run fmt` で修正してから必要な変更をステージしてください。
既存の作業環境では `mise run hooks:install` でフックを登録・更新でき、
`mise run hooks:check` で同じチェックを手動実行できます。
単体テスト・ビルド・ブラウザテストは次のコマンドと CI で実行します。

```bash
mise run check
mise run lint
npx playwright install chromium
mise run test:browser
```

CI は同じ型検査・lint・整形チェック・回帰テスト・ビルド・ブラウザテストを実行します。
読み取り権限だけを持ち、シークレットを必要としません。
通常 CI の実行環境は [CI の運用](docs/ci.md) を参照してください。
アイコン更新の PR 作成だけは、1Password から専用の認証情報を取得します。
値をコード、モデル、ログへ出力する手順は使用しません。

## 初期版の範囲と制約

AWS・Google Cloud・Azure・GitHub・外部サービスを DSL で記述できます。
代表クラウドサービスは公式アイコン、SaaS は公式配布素材または Simple Icons の固定版を表示します。未知の種別は種別名を含む代替表示になります。
Terraform は AWS を優先します。plan/state の実体は保持しますが、アカウントを provider alias から推定しません。
SG は重複可能な関連であり、許可規則だけで通信成立を判断しません。
参照や `depends_on` は依存関係として描画します。

Google Cloud・Azure の Terraform、HCL の全面的な式評価、外部 module の取得、SG ルールの到達性検証、
カード寸法の固定、セマンティックズーム、ホスティング、npm 公開は未対応です。
同じ入力と配置版での再現性は検証します。固定したノードの座標は維持します。未固定ノードの配置の安定性は保証しません。

リポジトリ管理者は CI の必須チェックと、アイコン更新用の Actions secrets を設定してください。

## ブラウザー内の構成図チャット

上部の「チャット」から、自然言語でDSLの作成・変更を依頼できます。
「LLM接続先」でQwen・APIキーを使うChat Completions互換API・Amazon Bedrockを切り替えられます。
Qwenは静的HTMLでも利用できます。外部LLMはローカルの `preview` または開発サーバーが必要です。
[WebLLM](https://webllm.mlc.ai/) を使用し、会話・DSLの推論は端末内で行います。
WebGPU対応のChrome/Edgeなどと、HTTPSまたはlocalhostが必要です。
既定は品質を優先したQwen Coder 3Bです。軽量な1.5Bにも切り替えられます。
モデルを選び「モデルを読み込む」を押すと、初回に数百MB〜GB規模のモデルを取得します。
GPUメモリが不足すると初期化に失敗します。再利用時はブラウザーのキャッシュを使用します。

生成結果は構文・参照を検証してDSLの候補として表示します。「図に反映」で適用してください。
不正な結果は一度自動修正し、失敗時は元の図を保持します。生成の中止と候補の破棄も可能です。
生成後に現在のDSLを変更した場合は、古い候補を適用できません。
小型モデルのため、複雑な依頼や大きな図では生成に失敗する場合があります。

### 利用者自身のAPIキー・AWS認証で接続する

接続先のフォームからAPIキー・接続先URL・モデル名、Bedrockのモデル名・AWSプロファイル・リージョンを設定できます。
「接続設定を保存」は端末に永続保存し、再起動せず反映します。保存時にLLMは呼び出しません。
APIキーは保存後に入力欄から消え、再表示されません。空欄で保存すると既存のキーを維持しますが、URL変更時は再入力が必要です。
入力中のキーを除き、画面・DSL・モデル入力・ブラウザーのストレージには認証情報を保存しません。
画面の設定は同じ端末のサーバーで共有され、サーバーの再起動後も保持されます。
「起動時の設定に戻す」で画面の設定を解除できます。起動時の環境変数や既存のAWSプロファイルも引き続き利用できます。
「接続テスト」は保存済み設定で短い応答を生成し、認証・選択モデルへのアクセスと応答を確認します。
会話・DSL・リポジトリのコードは送信せず、図や設定も変更しません。出力上限は64トークン、自動再試行はありません。
少量のAPI利用料金が発生する場合があります。中止でき、モデル呼び出しの待ち時間は最大30秒です。
フォーム編集後は保存してからテストしてください。接続成功はDSL生成の成功を保証しません。
AWSプロファイル・リージョンの空欄はSDKの既定設定を使います。AWS秘密鍵を画面に入力する必要はありません。
APIキーはmacOS Keychain・Windows資格情報マネージャー・Linux Secret Serviceへ保存します。
LinuxではSecret Serviceを明示的に使用し、再起動で消えるキーリングや平文ファイルへは切り替えません。
対応する資格情報ストアがない場合やロック・権限エラー時は保存を拒否し、画面に理由を表示します。
Windows・Linuxの実機検証は未実施です。Linuxには利用可能なSecret ServiceとD-Busのユーザーセッションが必要です。

URL・モデル名・AWSプロファイル・リージョンなどは次の `llm-settings.json` に保存します。
ファイルにはAPIキーを含めず、資格情報ストア内の参照IDだけを記録します。
POSIXでは専用ディレクトリを0700、設定ファイルを0600で作成し、原子的に更新します。

| OS      | 標準の設定ディレクトリ                                          |
| ------- | --------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Infra Canvas`                    |
| Windows | `%LOCALAPPDATA%\\Infra Canvas`                                  |
| Linux   | `$XDG_CONFIG_HOME/infra-canvas` または `~/.config/infra-canvas` |

`INFRA_LLM_CONFIG_DIR` で専用ディレクトリを指定できます。設定だけを別端末へコピーしてもAPIキーは移行されません。
「起動時の設定に戻す」は永続設定と保存したキーを解除し、環境変数の設定へ戻します。
既存の環境変数・`.env.llm` は自動変更しません。フォーム経由のAPIキー保存にはOSの資格情報ストアを使用します。
外部LLMで「DSLを生成」「LLMで概要を補足」を実行すると、会話・DSL・コードの抜粋と解析根拠を接続先へ送信します。
LLMサービスの料金は利用者負担です。構文エラー時の自動修正も追加のAPI呼び出しになり、最大1回に制限しています。

共通の設定例は [.env.example](.env.example) を参照してください。
`.env.llm` にコピーして編集し、次のように起動できます（Node.js 24以上）。
`.env.llm` はGitの追跡対象外です。設定の反映にはサーバーの再起動が必要です。

```bash
node --env-file=.env.llm dist/cli.js preview examples/subnet-security.infra --port 5195
```

開発サーバーを使う場合は、ビルドせずに次のように起動できます。
これらのNode.jsコマンドはmacOS・Linux・Windowsで共通です。

```bash
node --env-file=.env.llm node_modules/vite/bin/vite.js --host 127.0.0.1
```

| 接続先                  | サーバー側の設定                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Chat Completions互換API | `INFRA_LLM_API_BASE_URL`（例：`https://api.mistral.ai/v1`）・`INFRA_LLM_API_MODEL`・`INFRA_LLM_API_KEY`             |
| Amazon Bedrock          | `INFRA_LLM_BEDROCK_MODEL`（Converse対応のモデルIDまたは推論プロファイル）・`AWS_REGION`・必要に応じて `AWS_PROFILE` |

APIは `/chat/completions` のテキスト応答に対応します。全プロバイダー・モデルとの互換性は保証しません。
JSONモードを受け付けない接続先には `INFRA_LLM_API_JSON_MODE=off` を設定してください。
接続URLはHTTPS、またはlocalhostのHTTPに限定し、認証情報付きURLやリダイレクトは受け付けません。
BedrockはAWS SDKの既定の認証チェーンを使います。環境変数・共有設定・既存のSSOセッションなどを利用でき、
SSOプロファイルは必要に応じて事前に `aws sso login --profile <profile>` を実行してください。
対象リージョン・モデルの利用権限とConverseの対応状況も確認してください。

外部LLMの出力上限は `INFRA_LLM_MAX_TOKENS`（既定4096、256〜16384）で設定できます。
同時生成はサーバー全体で1件、1回の待ち時間は最大120秒です。
現在は外部LLMの応答を一括受信します。生成中の経過時間と、取得できた場合の入出力トークン数を表示します。
出力上限や接続エラーでは現在の図を保持します。構文が正しくても依頼に合うとは限らないため、候補を確認してください。
これはループバック接続の個人用サーバー向けです。認証・課金・利用者別上限のあるWebサービスは未実装です。

### リポジトリから作成する

「リポジトリURLから作成」はGitHubのルートURLと任意のbranch/commit・対象フォルダーを受け付けます。
関連する `.infra`・Terraform・README・Wrangler・Compose・CDKなどのファイルを入口と参照先を優先し、最大48件・合計600KBまで取得します（1ファイル96KBまで）。
commitと取得ファイルを表示し、モデルの入力上限に合わせて抜粋します。ソースは実行しません。
既存の `.infra` があればモデルを起動せず候補として読み込めます。
Terraformのresource宣言とWranglerのJSON/JSONC/TOML設定から、モデルを起動せず最大20要素の概要候補を作ります。
DNS・個別権限は集約し、Wranglerのバインディングと検出した通知・デプロイ・DB接続・シークレット取得定義以外の通信は推定しません。
TOMLを含む設定の宣言を読み取りますが、変数・式・モジュール・環境差分の実行時評価には対応していません。
「LLMで概要を補足」で取得ファイルを基に候補を編集できます。
設計情報からの推定なので、生成した接続やサービスを確認してください。

ローカルの `preview` と `npm run dev` は既存のGitHub CLI認証を使用でき、非公開リポジトリにも対応します。
GitHub CLIが利用できない場合は公開APIへ切り替えます。静的HTML・静的配信版はブラウザーからGitHub APIを利用します。
非公開リポジトリには画面内の読み取り用トークン欄を使用できます。
トークンは保存せずGitHubの取得だけに使い、LLMには渡しません。チャット本文に認証情報を入力しないでください。
モデル未取得時はネット接続が必要で、リポジトリの取得にもGitHubへの接続が必要です。

解析の入口はワークフロー・package.json・tsconfig・Wrangler・Terraform・Composeなどです。
任意のファイル名でも、参照されたローカルスクリプトとJS/TSのimport・re-export・リテラルのrequire/import先を追跡します。
YAMLパーサーでjob・step・working-directory・ローカルActionを読み、npm/pnpm/yarnのスクリプトも照合します。
JS/TSはTypeScript ASTで呼び出しの所有関数・import別名・定数のコマンド引数を記録します。
コメントや単なる文字列を実際の呼び出しとして扱いません。

取得結果には依存参照・呼び出し位置・関係ごとの根拠ファイル/行・解析診断を付けます。
画面の「解析の根拠」で確認でき、LLMには抜粋より先に構造化した根拠を入力予算内で渡します。
サービスの識別にはWrangler・libSQL・Discord・1PasswordなどのAPI/設定の知識が引き続き必要です。
実行時の変数値・未確定の動的import・反射・完全な引数データフロー・実行条件・実行成功は未評価です。
Python/Go等の呼び出し追跡にはまだ対応していません。
読めなかった参照先や上限による省略は診断に残します。秘密値・秘密参照の項目名は生成DSLへ出力しません。

TOMLは専用パーサーで読み、Wranglerの環境・バインディング・mainを解析します。
tsconfigのローカルextends（配列を含む）、paths・baseUrl・ワイルドカード・候補配列を、定義元を基準に解決します。
外部npmパッケージのextendsや、プロジェクト参照・include/excludeに基づく厳密な設定選択は未対応です。
値伝播では定数、テンプレート、配列/object/spread、関数の引数・戻り値・callback、既知キーのdispatch、bind/call/applyを追跡します。
定数または引数から決まるimport/requireと、名前付きre-export・単純なCommonJS関数も追跡できます。
値や実行条件が未確定なら打ち切り、eval・外部API・対象コードは実行しません。ループ・クラス/プロトタイプ・反射の完全な評価は未対応です。
呼び出しは深さ12・512回、値の訪問は25,000回で打ち切り、動的参照の取得は最大4巡・16入口までです。
LLMへは秘密値を含まない引数受け渡し位置と解決数を、既存の根拠と一緒に渡します。

## AI 開発ルール

共通ルールは `.rulesync/rules/overview.md` にまとめています。
`mise run rules:generate` で Codex、Claude Code、Devin、Copilot 向けに rulesync 33.0.0 から生成します。
Codex・Devin は共通の `AGENTS.md`、Copilot は `.github/copilot-instructions.md` を使います。
Claude Code は `AGENTS.md` を読み込む構成とし、`includeRoot: false` で `CLAUDE.md` の出力を無効にしています。
Claude Code の `AGENTS.md` 対応には v2.1.277 以降が必要です。
非ルートのルールを追加した場合は `.claude/rules/` と `.devin/rules/` にも生成します。
`mise run rules:check` で差分を検出し、`mise run check` と CI でも検証します。
生成ファイルは直接編集せず、正本を更新してから生成してください。権限・MCP・認証設定は生成しません。

実行コマンドは `mise.toml` が正本で、npm scripts は互換入口です。
ビルド・アイコン収集など、まとまった処理の実装は既存スクリプトを保ち、mise から呼び出します。
公開用の Bash 処理は GitHub Actions の Linux 専用です。

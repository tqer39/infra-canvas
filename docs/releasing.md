# リリース運用

[Release ワークフロー](../.github/workflows/release.yml) は、タグ作成・GHCR 配布・両 CPU の匿名検証・`latest` 更新・日本語 GitHub Release 公開を順に実行します。
通常の [Docker CI](../.github/workflows/docker.yml) は PR・main・手動実行での検証専用です。タグを手動 push しても配布しません。

## リリース用 PR の準備

1. `package.json`、`package-lock.json` のトップレベルと `packages[""].version` を同じ SemVer に更新します。例は `0.2.0`、プレリリースは `0.2.0-rc.1` です。先頭の `v` と build metadata（`+...`）は指定しません。
2. `docs/release-notes-v0.2.0.md` を作成し、先頭を `# Infra Canvas v0.2.0` にして主な機能・変更点・必要な移行手順を日本語で記載します。初回版の [ノート](release-notes-v0.1.0.md) を参考にできます。Docker 起動コマンド・両 CPU の検証結果・digest・ソースのリンクはパイプラインが追記します。
3. README の案内と互換性を確認し、`mise run check`・`mise run test:browser` で検証して PR をレビュー・マージします。公開前の README には未配布のイメージを利用可能と記載しません。公開後の利用者向けリンクは Release の一覧を使うか、配布を確認してから更新します。
4. マージ後の main で通常 CI と Docker CI の両方が成功するまで待ちます。

## 公開する

GitHub Actions の **Release → Run workflow** でブランチ **main** を選び、`version` に `0.2.0` などを入力します。CLI でも開始できます。

```bash
gh workflow run release.yml --repo tqer39/infra-canvas --ref main -f version=0.2.0
```

実行開始時の main の SHA に固定されます。待機中に main が進んでも、別のソースへ切り替わりません。
異なる版も含めて公開処理を直列化し、途中の実行を新しい実行でキャンセルしません。
権限は対象ジョブの `GITHUB_TOKEN` に限定し、追加の PAT や GitHub App の権限変更は不要です。

1. **prepare**：対象 SHA の main CI 成功、package/lockfile の版、日本語ノートを確認し、`v<version>` タグを作成します。同名タグが別 SHA を指す場合は停止します。
2. **publish**：バージョン固定タグだけを GHCR に配布します。既存の版は両 CPU の版・リビジョン・manifest/config の digest を照合し、一致すればビルドせず再利用します。404 以外の通信・認証・レート制限エラーを未公開とは解釈しません。
3. **verify**：`ubuntu-24.04` の amd64 と `ubuntu-24.04-arm` の arm64 で、空の Docker 認証設定を使って匿名 pull します。配布 digest に固定して HTTP・API 保護・非 root・ブラウザー操作・DSL 保存/読み込み・healthcheck・マウントを検証し、前後でバージョンタグが同じ digest を指していることも確認します。
4. **finalize**：両 CPU が成功した後だけ、タグと digest を再確認します。安定版は検証済み index をそのまま `latest` にコピーし、日本語 GitHub Release を公開します。プレリリースは `latest` と GitHub の Latest Release を更新しません。既存の `latest` より古い安定版や同じ版の別 digest は拒否します。

`GITHUB_TOKEN` でのタグ作成による push イベントは別ワークフローを起動しないため、全工程を同じワークフロー内の依存ジョブでつないでいます。
パッケージは Public である必要があります。現在の infra-canvas は公開済みです。他のリポジトリへ導入する際の初回 Public 設定は管理者が行い、パイプラインはアクセス設定を変更しません。

## 失敗・再実行

GitHub Actions の **Re-run failed jobs** または **Re-run all jobs** で同じ実行を再実行してください。対象 SHA と入力は維持されます。
別の main SHA から同じ版を新規実行すると、タグの衝突として停止します。別のソースを配布する場合は、新しい版のリリース用 PR を作成します。

- タグ作成後に失敗しても、同じ SHA のタグは再利用します。タグの付け直し・削除はしません。
- GHCR 配布後に失敗しても、版と SHA が一致するイメージは digest を確認して再利用し、毎回匿名検証を行います。バージョン固定タグを別のビルドで上書きしません。
- 検証失敗時は `latest` 更新と Release 公開へ進みません。バージョン固定イメージと Git タグは診断・再実行用に残ります。
- `latest` 更新と GitHub Release 公開は別サービスの操作で、原子的には実行できません。`latest` 更新後に Release API が失敗した場合は、同じ digest の更新を省略し Release 公開から復旧します。
- 同じタグ・SHA・digest の識別情報を持つ公開済み Release は変更せず、手編集したノートも保持します。過去の公開済み実行を再実行しても、後続版の `latest` は巻き戻しません。同じ識別情報の draft は公開へ進めます。他の内容の既存 Release は上書きせず停止します。
- 手動作成済みの v0.1.0 はこのパイプラインの識別情報を持ちません。既存版の移行には使わず、次の版から利用してください。

## ローカルでの検証

リリース処理の回帰テストは `mise run check` に含まれます。タグの衝突、既存イメージの照合、匿名 OCI アクセス、公開途中の失敗からの復旧、プレリリースと降格拒否、ワークフローの依存関係・権限を検証します。

実際の公開イメージの読み取り検証例です。`GITHUB_SHA` はそのイメージのソースで、ローカル作業ツリーの SHA ではありません。このコマンドはタグ作成・配布・Release 公開を行いません。

```bash
RELEASE_VERSION=0.1.0 \
GITHUB_REPOSITORY=tqer39/infra-canvas \
GITHUB_SHA=e49ec920acb0c930cf0721e2ebca1d4a2e05a51e \
IMAGE_DIGEST=sha256:66fe8b3cbac5d3dc845275b6a941fa79f6785df0e828e4a551f33a6c0fc64de9 \
mise run release:verify
```

`release:prepare` と `release:finalize` は公開操作を伴う Release workflow 専用コマンドです。ローカル検証では実行しません。

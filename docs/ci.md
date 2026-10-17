# CI の実行環境

通常の検証と月次アイコン更新は GitHub-hosted の `ubuntu-24.04` で実行します。
private・public の両方で動作し、個人のサーバーや常設 runner を必要としません。
private の間は契約プランの実行時間・利用上限を確認してください。

## 通常の検証

`pull_request` と `main` への push で検証します。
各ジョブは使い捨ての独立した VM を使い、3シャード・各2ワーカーでブラウザーを検証します。
静的検証はシャード1で一度実行します。文書などの既知の変更だけならブラウザー検証を省略します。
共有生成物は各ジョブのブラウザー検証開始時に一度だけ準備します。
`workflow-result` は全シャードの成功だけを許可し、失敗・中止・未実行を拒否します。

通常 CI は `contents: read` のみで、シークレットを渡しません。
checkout の資格情報は永続化せず、外部 Action は完全なコミット SHA で固定します。
PR のコードを秘密情報付きで実行する `pull_request_target` は使いません。

月次アイコン更新は既定ブランチだけを取得し、差分がある場合に全検証します。
秘密情報は PR 作成時だけ取得します。設定手順は [アイコン運用](assets.md) を参照してください。

## 旧 runner からの移行

旧 self-hosted runner 5台の登録は2026年10月17日に解除し、登録数0件を確認しました。
同日の再確認でホスト側4サービス・専用 VM 側1サービスが停止状態であることを確認しました。
専用 VM 側1件と、管理者が操作したホスト側4件を再確認し、全5件が inactive/disabled でした。
Docker 配布 PR #27 もマージ済みで、現行 main のワークフローは GitHub-hosted に統一されています。
登録の解除とホストの停止は本リポジトリのファイル変更だけでは完了しません。
同日に管理者の指示で Terraform を通じて public 化しました。経緯は [監査記録](publication-audit.md) を参照してください。

[GitHub のセキュリティ指針](https://docs.github.com/en/actions/reference/security/secure-use) に従い、
外部 PR の実行先に個人環境の常設 runner を使わないでください。

## Docker ビルド記録の保存方針

Docker CI と Release の `docker/build-push-action` に `DOCKER_BUILD_RECORD_UPLOAD: 'false'` を設定し、
`.dockerbuild` ファイルの Actions artifact への自動アップロードを無効化します。
ビルドのジョブ summary と通常ログは維持し、配布版は Release の digest・ソース SHA・検証結果で追跡します。
GHCR のイメージと provenance はこの設定の対象外です。
設定の意味は [Action の公式説明](https://github.com/docker/build-push-action#environment-variables) を参照してください。

この設定は既存 artifact の保持期限を変更・削除しません。2026年10月17日の再確認では19件が残存し、
保持期限は作成から90日（2027年1月14〜15日）でした。今回の設定適用後は新規アップロードを止め、
既存分は現在の期限で失効させます。過去の4件の削除記録と、今回の19件は別です。

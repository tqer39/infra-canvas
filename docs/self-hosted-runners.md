# Self-hosted runner の運用

private リポジトリの CI を Ubuntu Server 24.04 x64 で実行します。
通常 CI と月次アイコン更新の全ジョブを self-hosted にし、GitHub-hosted の無料分を消費しません。
artifact・cache の保存料金は別です。

## 構成

| runner                   | Linux ユーザー | ラベル                   | サービス                                |
| ------------------------ | -------------- | ------------------------ | --------------------------------------- |
| infra-canvas-ci-1        | ic-ci-1        | infra-canvas-ci          | infra-canvas-runner-ci-1.service        |
| infra-canvas-ci-2        | ic-ci-2        | infra-canvas-ci          | infra-canvas-runner-ci-2.service        |
| infra-canvas-maintenance | ic-maintenance | infra-canvas-maintenance | infra-canvas-runner-maintenance.service |

各ユーザーのホームは `/var/lib/infra-canvas-<slot>`、runner はその中の `runner`、
作業領域は `runner/_work` です。ホームは所有者だけがアクセスできます。
sudo・Docker グループへの所属は追加しません。
各サービスは CPU 上限4コア相当・メモリ上限6GiB・低い CPU 優先度で動作します。
3サービス合計の上限は12コア相当・18GiBです。既存サービスの設定や起動状態は変更しません。

通常 CI は空いている2つの runner に割り当てます。ブラウザーは従来どおり2シャード・各1ワーカーです。
静的検証の実行中は片方のシャードが待機する場合があります。
同一ホスト上でポートを共有するため、シャード1は5181、シャード2は5182、アイコン更新は5183を使います。
各 runner のワークスペースとブラウザーキャッシュは別です。

Node・Python はワークフローの mise-action と `mise.toml` から準備します。
小さな変更判定・結果集約ジョブでも Node の準備を明示し、ホストに既存の Node を要求しません。
ジョブは `mise run browser:install` で Chromium のみ取得します。
OS依存ライブラリと gh は初回に管理者が導入するため、ジョブに sudo は不要です。

## 初回セットアップ

`scripts/provision-runners.sh` は Ubuntu 24.04 x64 専用です。
macOS・Windows や一般の開発環境には runner の OS パッケージを追加しません。
GitHub が repository runner downloads API で提示した runner 2.337.0 の SHA-256 を検証して展開します。
登録後の runner 自動更新は有効です。

管理端末の gh で対象リポジトリ用の短期登録トークンを発行し、サーバーの所有者専用ファイルへ渡します。
トークンはチャット・ログ・Gitへ出力せず、登録完了後に削除します。
サーバーで次を実行します。トークンの有効期間は約1時間です。

```bash
sudo bash provision-runners.sh /path/to/registration-token
```

スクリプトは専用ユーザー、依存パッケージ、systemd サービスを作成します。
既存の登録ファイルがあれば再登録せず、同じユーザーのホーム・グループが想定と違えば停止します。
apt による OS 全体の upgrade や既存サービスの再起動は行いません。
既存の登録が壊れた場合は、GitHub 側とホストの状態を確認してから再構築します。

## 確認・停止

```bash
gh api repos/tqer39/infra-canvas/actions/runners \
  --jq '.runners[] | {name, status, busy}'
systemctl status infra-canvas-runner-ci-1.service
sudo journalctl -u infra-canvas-runner-ci-1.service --since today
sudo systemctl stop infra-canvas-runner-ci-1.service
sudo systemctl start infra-canvas-runner-ci-1.service
```

同じ操作を ci-2・maintenance にも適用できます。サービスはホストの起動時に自動起動します。
停止・スリープ・ネットワーク断の間はジョブが待機し、hosted への自動フォールバックは行いません。
稼働中ジョブを確認してからサービスやホストを停止してください。
`_work`、`_diag`、各ホームの `.cache` のディスク使用量を定期的に確認します。
キャッシュ削除・OS依存更新は実行中のジョブがない状態で行います。
新しい Playwright が別の OS 依存を要求する場合は、管理者が導入スクリプトの依存一覧も更新します。

## 信頼範囲

systemd で個別ホーム以外のシステム領域への書き込みを制限し、
`/home`・`/srv`・`/mnt`・`/media` と Docker ソケットをサービスから隠します。
既存メディアサービスは動作を継続します。ただしネットワークアクセスは隔離していません。
同じホスト・カーネルを共有するため、別ユーザー・ラベルは VM のようなセキュリティ境界ではありません。
private の信頼できる変更だけを実行する前提です。

保守用 runner は別ユーザーとし、1Password・GitHub App の秘密情報は従来どおり保守ジョブ内で取得します。
通常 CI の常設環境に手動で資格情報を保存しません。
ただしリポジトリのワークフローを変更できる人は保守用ラベルも指定できるため、ラベルだけでアクセス制御はできません。
書き込み権限を信頼できる人に限定し、認証情報を扱うワークフローの変更をレビューしてください。

ワークフローは `github.event.repository.private` を確認します。
public 化した場合は self-hosted を自動継続せず、標準 GitHub-hosted へ移行してください。
この確認は未信頼のワークフロー変更に対する保護にはならないため、公開前に runner 登録も解除します。

仕様の根拠は [GitHub の runner 参照](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)、
[サービス設定](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application)、
[セキュリティ指針](https://docs.github.com/en/actions/reference/security/secure-use)です。

# Docker 用 self-hosted runner

通常 CI と既存サービスを動かす Ubuntu Server 24.04 上に、LXD/KVM の専用 VM を置きます。
ホストの通常 CI ユーザーに Docker 権限を付けず、ホストの Docker ソケット・ディレクトリーを VM に渡しません。
GitHub-hosted の利用枠は使いません。GHCR の保存・転送などの料金は別です。

## 構成

| 項目                 | 設定                                                 |
| -------------------- | ---------------------------------------------------- |
| VM・GitHub runner 名 | `infra-canvas-docker`                                |
| runner ラベル        | `self-hosted`, `Linux`, `X64`, `infra-canvas-docker` |
| ゲスト               | Ubuntu 24.04 amd64、KVM による VM                    |
| 上限                 | 4 vCPU、6 GiB RAM、35 GiB ディスク                   |
| ストレージ           | 専用 LXD pool `infra-canvas-docker`、dir driver      |
| ネットワーク         | `icdocker0`、macvlan、親 NIC `enp2s0`、LAN の DHCP   |
| VM 内ユーザー        | `ic-docker`、ホーム `/var/lib/infra-canvas-docker`   |
| VM 内サービス        | `infra-canvas-runner-docker.service`                 |
| Docker               | VM 内の Docker Engine・Buildx                        |
| CPU 対応             | amd64 はネイティブ、arm64 は qemu-user-static/binfmt |

runner は1つで、matrix の2ジョブを順番に実行します。別 PR と同時に VM 内でビルドしません。
検証用イメージのタグは実行 ID と CPU ごとに分け、検証後に削除します。
既存の通常 CI 3台と保守用1台のユーザー・サービス・上限・Docker ソケットの遮断は維持します。
VM にはホストの最大6 GiBを追加で使うため、通常 CI・保守・既存サービスを含めた実使用量を監視してください。
VM のディスク容量は疎なファイルの最大容量で、dir pool 全体の容量予約ではありません。

## 初回セットアップ

ホストは Ubuntu 24.04 x64、`/dev/kvm` が利用可能で、LXD 5.21 LTS が動作することを前提とします。
LXD が未導入なら管理者が `sudo snap install lxd --channel=5.21/stable` で導入します。
実行ユーザーには LXD の管理権限が必要です。LXD 管理権限もホストの root 相当として扱います。
この専用 VM の作成に通常 CI の登録トークン・サービス・Docker グループは流用しません。

ホストへ `scripts/ci` の2つのスクリプトをコピーし、同じディレクトリーに置きます。
管理端末の gh で短期の repository runner 登録トークンを作成し、ホストの所有者専用ファイルへ安全に転送します。
トークンをチャット・ログ・Git に出力しないでください。

```bash
umask 077
gh api --method POST repos/tqer39/infra-canvas/actions/runners/registration-token --jq .token > /tmp/infra-canvas-docker-token
```

ホストで実行します。ローカルのトークンファイルは転送後に削除します。

```bash
bash scripts/ci/provision-docker-vm.sh /path/to/registration-token
```

ホスト側スクリプトは専用 pool・macvlan ネットワーク・VM を作成し、VM の起動と cloud-init 完了を待ちます。
既存 VM に追加プロファイル・ホスト共有・異なるリソース設定があれば、登録トークンを渡す前に停止します。
VM には SSH 鍵・ホストの認証情報をコピーせず、管理には `lxc exec` を使います。
使用した Ubuntu イメージの fingerprint はスクリプトの最後に表示し、LXD の `volatile.base_image` に残します。

ゲスト側スクリプトは、専用のホスト名・Ubuntu バージョン・KVM VM であることを確認してから導入します。
Docker は公式 apt リポジトリ、QEMU と Chromium の OS 依存は Ubuntu パッケージから導入します。
runner と mise の配布物は SHA-256 を確認します。runner の自動更新は有効です。
登録トークンは環境変数で runner に渡し、ホスト・VM のトークンファイルは処理終了時に削除します。
再実行時は既存の runner を再登録せず、実行中サービスも再起動しません。
ホスト側のパッケージ全体の upgrade・既存サービスの再起動は行いません。
追加依存は Ubuntu CI 基盤専用であり、macOS・Windows の開発環境に追加する必要はありません。

## ネットワーク

ゲストは macvlan で LAN に独立した IP を持ち、GitHub・GHCR・Docker・Ubuntu の配布元へ接続します。
親 NIC はこのホストの有線 NIC `enp2s0` です。別ホストでは NIC 名と LAN の DHCP の利用可否を先に確認します。
LXD の NAT bridge はホスト Docker の転送ルールと競合したため採用せず、既存の Docker や FORWARD ポリシーは変更していません。
macvlan では親 NIC のホストと VM が直接通信できないため、管理には LXD の VM agent を使います。
VM の管理用 SSH 鍵は配置しませんが、VM 自体が LAN に属するため、LAN 上の他端末からの到達性を完全に遮断するものではありません。
ホストへの VM のポート公開は不要です。テストの公開ポートは VM 内の `127.0.0.1` に限定します。

## 検証・配布

[Docker workflow](../.github/workflows/docker.yml) は private リポジトリに限定し、検証・配布とも専用ラベルを要求します。
PR・main・手動実行で両 CPU をビルドし、HTTP・API保護・図の編集・DSL保存/読み込み・マウントを検証します。
QEMU/binfmt はゲスト管理者が初回に準備します。ジョブ内で `--privileged` や sudo を使って再設定しません。
バージョンタグの push 時だけ、両 CPU の検証成功後に同じ runner で GHCR へ配布します。
PR では配布ジョブを省略します。`packages: write` は配布ジョブだけに付与し、認証にはジョブの `GITHUB_TOKEN` を使います。
public 化する際は self-hosted の登録と信頼範囲を見直してください。

## 監視・停止

ホストの LXD 管理ユーザーで実行します。

```bash
/snap/bin/lxc info infra-canvas-docker
/snap/bin/lxc exec infra-canvas-docker -- systemctl status infra-canvas-runner-docker.service
/snap/bin/lxc exec infra-canvas-docker -- docker system df
/snap/bin/lxc exec infra-canvas-docker -- journalctl -u infra-canvas-runner-docker.service -n 50
/snap/bin/lxc config get infra-canvas-docker volatile.base_image
```

VM と runner はホスト起動後に自動起動します。停止する前に [runner 一覧](https://github.com/tqer39/infra-canvas/settings/actions/runners) でジョブが実行中でないことを確認します。
停止は `/snap/bin/lxc stop infra-canvas-docker`、再開は `/snap/bin/lxc start infra-canvas-docker` です。
VM 内の Docker データ・runner の作業領域の容量を監視し、キャッシュの整理はジョブがない時に行います。
Docker 権限は VM 内の root 相当です。VM は専用ユーザーより強い境界ですが、ネットワークを完全に隔離するものではありません。
ホストや他サービスの認証情報を VM に置かず、信頼できる private リポジトリの変更だけを実行してください。

仕様の根拠は [LXD の VM 作成](https://documentation.ubuntu.com/lxd/latest/howto/instances_create/)、
[Docker の Ubuntu 導入](https://docs.docker.com/engine/install/ubuntu/)、
[マルチプラットフォームビルド](https://docs.docker.com/build/building/multi-platform/) です。

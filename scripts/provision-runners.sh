#!/usr/bin/env bash
# Ubuntu 24.04 x64 専用。管理者が一度実行し、runner に sudo 権限を与えない。
set -euo pipefail
set +x
umask 077
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  echo '使用方法: sudo bash provision-runners.sh REGISTRATION_TOKEN_FILE' >&2
  exit 1
fi
source /etc/os-release
if [[ $ID != ubuntu || $VERSION_ID != 24.04 || $(uname -m) != x86_64 ]]; then
  echo 'Ubuntu 24.04 x64 専用です。' >&2
  exit 1
fi
token_file=$1
IFS= read -r registration_token < "$token_file"
[[ -n $registration_token ]]
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"; unset registration_token' EXIT

# サービス再起動やOS全体のupgradeを行わず、不足するCI依存だけを導入する。
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git gh tar xz-utils unzip libicu74 libssl3t64 zlib1g \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
  libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  fonts-noto-color-emoji fonts-liberation fonts-ipafont-gothic

# GitHub の repository runner downloads API が提示した配布物とSHA-256。
runner_version=2.337.0
archive="$temporary/runner.tar.gz"
curl --fail --location --retry 3 \
  "https://github.com/actions/runner/releases/download/v$runner_version/actions-runner-linux-x64-$runner_version.tar.gz" \
  --output "$archive"
echo "70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613  $archive" | sha256sum --check

# 通常CIはActionの毎回ダウンロードを避け、検証済みのmiseを常設する。
curl --fail --location --retry 3 \
  https://github.com/jdx/mise/releases/download/v2026.9.9/mise-v2026.9.9-linux-x64.tar.gz \
  --output "$temporary/mise.tar.gz"
echo "e4767e4854af5daeff2191b2bbdc94f834742a23efad591dbd33187861d41604  $temporary/mise.tar.gz" | sha256sum --check
tar -xzf "$temporary/mise.tar.gz" -C "$temporary"

for slot in ci-1 ci-2 ci-3 maintenance; do
  account="ic-$slot"
  directory="/var/lib/infra-canvas-$slot"
  name="infra-canvas-$slot"
  label=infra-canvas-ci
  cpu_quota=400%
  memory_max=6G
  if [[ $slot == maintenance ]]; then
    label=infra-canvas-maintenance
    cpu_quota=200%
    memory_max=4G
  fi
  if id "$account" >/dev/null 2>&1; then
    [[ $(getent passwd "$account" | cut -d: -f6) == "$directory" ]]
    [[ $(id -Gn "$account") == "$account" ]]
  else
    useradd --system --user-group --create-home --home-dir "$directory" --shell /usr/sbin/nologin "$account"
  fi
  chmod 700 "$directory"
  install -d -o "$account" -g "$account" -m 700 "$directory/.local/share/mise/bin"
  install -o "$account" -g "$account" -m 755 "$temporary/mise/bin/mise" "$directory/.local/share/mise/bin/mise"
  if [[ ! -f "$directory/runner/.runner" ]]; then
    install -d -o "$account" -g "$account" -m 700 "$directory/runner"
    tar -xzf "$archive" -C "$directory/runner"
    chown -R "$account:$account" "$directory/runner"
    # トークンを引数・ログへ出さず、runner公式の環境変数入力を使う。
    (
      cd "$directory/runner"
      export ACTIONS_RUNNER_INPUT_TOKEN="$registration_token"
      runuser -u "$account" -- ./config.sh --unattended \
        --url https://github.com/tqer39/infra-canvas \
        --name "$name" --labels "$label" --work _work
    )
  fi
  # デフォルトと同じrunsvc.sh入口を使い、専用ユーザー・リソース上限を設定する。
  cat > "/etc/systemd/system/infra-canvas-runner-$slot.service" <<UNIT
[Unit]
Description=Infra Canvas GitHub Actions runner ($slot)
Wants=network-online.target
After=network-online.target

[Service]
User=$account
Group=$account
WorkingDirectory=$directory/runner
Environment=HOME=$directory
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=$directory/runner/bin/runsvc.sh
Restart=on-failure
RestartSec=10
KillMode=control-group
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$directory
InaccessiblePaths=-/srv -/mnt -/media -/run/docker.sock -/run/containerd
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
CPUQuota=$cpu_quota
CPUWeight=20
MemoryMax=$memory_max
TasksMax=2048

[Install]
WantedBy=multi-user.target
UNIT
done
systemctl daemon-reload
for slot in ci-1 ci-2 ci-3 maintenance; do
  systemctl enable --now "infra-canvas-runner-$slot.service"
  cpu_quota=400%
  memory_max=6G
  if [[ $slot == maintenance ]]; then
    cpu_quota=200%
    memory_max=4G
  fi
  # 既存サービスにも再起動せず適用する。再起動後は上記unitの値を使う。
  systemctl set-property --runtime "infra-canvas-runner-$slot.service" \
    CPUQuota="$cpu_quota" MemoryMax="$memory_max"
  systemctl is-active "infra-canvas-runner-$slot.service"
done
rm -f "$token_file"
echo 'runner 4台のサービスを起動しました。GitHub 側の online 状態を確認してください。'

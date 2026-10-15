#!/usr/bin/env bash
# infra-canvas-docker 専用VM内だけで実行する。ホストには実行しない。
set -euo pipefail
set +x
umask 077
if [[ $EUID -ne 0 || $# -ne 1 || ! -f $1 || $(hostname) != infra-canvas-docker ]]; then
  echo '専用VM内で使用: bash provision-docker-runner.sh REGISTRATION_TOKEN_FILE' >&2
  exit 1
fi
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]]
[[ $(systemd-detect-virt) == kvm ]]
token_file=$1
IFS= read -r registration_token < "$token_file"
[[ -n $registration_token ]]
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"; rm -f "$token_file"; unset registration_token' EXIT
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git tar xz-utils unzip libicu74 libssl3t64 zlib1g \
  qemu-user-static binfmt-support \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
  libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  fonts-noto-color-emoji fonts-liberation fonts-ipafont-gothic
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg \
  --output /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<'SOURCES'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
apt-get update
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin
systemctl enable --now docker binfmt-support
update-binfmts --enable qemu-aarch64
account=ic-docker
directory=/var/lib/infra-canvas-docker
if ! id "$account" >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir "$directory" --shell /usr/sbin/nologin "$account"
fi
[[ $(getent passwd "$account" | cut -d: -f6) == "$directory" ]]
# Dockerのroot相当権限はこのVM内の専用ユーザーにだけ与える。
usermod -aG docker "$account"
chmod 0700 "$directory"
curl --fail --location --retry 3 \
  https://github.com/jdx/mise/releases/download/v2026.9.9/mise-v2026.9.9-linux-x64.tar.gz \
  --output "$temporary/mise.tar.gz"
echo "e4767e4854af5daeff2191b2bbdc94f834742a23efad591dbd33187861d41604  $temporary/mise.tar.gz" | sha256sum --check
tar -xzf "$temporary/mise.tar.gz" -C "$temporary"
install -d -o "$account" -g "$account" -m 0700 "$directory/.local/share/mise/bin"
install -o "$account" -g "$account" -m 0755 "$temporary/mise/bin/mise" "$directory/.local/share/mise/bin/mise"
if [[ ! -f "$directory/runner/.runner" ]]; then
  curl --fail --location --retry 3 \
    https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz \
    --output "$temporary/runner.tar.gz"
  echo "70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613  $temporary/runner.tar.gz" | sha256sum --check
  install -d -o "$account" -g "$account" -m 0700 "$directory/runner"
  tar -xzf "$temporary/runner.tar.gz" -C "$directory/runner"
  chown -R "$account:$account" "$directory/runner"
  (
    cd "$directory/runner"
    export ACTIONS_RUNNER_INPUT_TOKEN="$registration_token"
    runuser -u "$account" -- ./config.sh --unattended \
      --url https://github.com/tqer39/infra-canvas \
      --name infra-canvas-docker --labels infra-canvas-docker --work _work
  )
fi
cat > /etc/systemd/system/infra-canvas-runner-docker.service <<'UNIT'
[Unit]
Description=Infra Canvas Docker runner (dedicated VM)
Wants=network-online.target
After=network-online.target docker.service binfmt-support.service
Requires=docker.service

[Service]
User=ic-docker
Group=ic-docker
SupplementaryGroups=docker
WorkingDirectory=/var/lib/infra-canvas-docker/runner
Environment=HOME=/var/lib/infra-canvas-docker
Environment=PATH=/var/lib/infra-canvas-docker/.local/share/mise/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/var/lib/infra-canvas-docker/runner/bin/runsvc.sh
Restart=on-failure
RestartSec=10
KillMode=control-group
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now infra-canvas-runner-docker.service
runuser -u "$account" -- docker run --rm --platform linux/arm64 \
  node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 node --version
systemctl is-active infra-canvas-runner-docker.service

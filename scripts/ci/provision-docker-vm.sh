#!/usr/bin/env bash
# Ubuntu Server の LXD 管理ユーザーで実行する。ホストのDocker権限は変更しない。
set -euo pipefail
set +x
umask 077
if [[ $# -ne 1 || ! -f $1 ]]; then
  echo '使用方法: bash scripts/ci/provision-docker-vm.sh REGISTRATION_TOKEN_FILE' >&2
  exit 1
fi
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]]
lxc=/snap/bin/lxc
[[ -x $lxc && -c /dev/kvm ]]
vm=infra-canvas-docker
token_file=$1
trap 'rm -f -- "$token_file"' EXIT
directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if ! "$lxc" storage show "$vm" >/dev/null 2>&1; then
  "$lxc" storage create "$vm" dir
fi
if ! "$lxc" network show icdocker0 >/dev/null 2>&1; then
  "$lxc" network create icdocker0 --type=macvlan parent=enp2s0
fi
if ! "$lxc" info "$vm" >/dev/null 2>&1; then
  "$lxc" launch ubuntu:24.04 "$vm" --vm --no-profiles \
    --storage "$vm" --network icdocker0 \
    -c limits.cpu=4 -c limits.memory=6GiB -c boot.autostart=true -d root,size=35GiB
fi
# 既存の別用途インスタンスやホストディレクトリーを引き継がない。
"$lxc" query "/1.0/instances/$vm" | python3 -c '
import json, sys
v = json.load(sys.stdin)
assert v["type"] == "virtual-machine"
assert not v["profiles"]
assert v["expanded_config"]["limits.cpu"] == "4"
assert v["expanded_config"]["limits.memory"] == "6GiB"
assert set(v["expanded_devices"]) == {"root", "eth0"}
assert v["expanded_devices"]["root"]["pool"] == "infra-canvas-docker"
assert v["expanded_devices"]["eth0"]["network"] == "icdocker0"
'
"$lxc" start "$vm" 2>/dev/null || [[ $("$lxc" list "$vm" -c s --format csv) == RUNNING ]]
ready=false
for ((i=0; i<120; i++)); do
  if "$lxc" exec "$vm" -- true 2>/dev/null; then ready=true; break; fi
  sleep 2
done
[[ $ready == true ]]
"$lxc" exec "$vm" -- cloud-init status --wait
"$lxc" file push "$directory/provision-docker-runner.sh" "$vm/root/provision-docker-runner.sh" --mode 0700
"$lxc" file push "$token_file" "$vm/root/runner-registration-token" --mode 0600
"$lxc" exec "$vm" -- bash /root/provision-docker-runner.sh /root/runner-registration-token
rm -f -- "$token_file"
"$lxc" config get "$vm" volatile.base_image
echo '専用VMとDocker runnerを準備しました。'

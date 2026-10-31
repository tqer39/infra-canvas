#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?App token is required}"
: "${GH_REPO:?Repository is required}"
: "${BASE_BRANCH:?Base branch is required}"
gh auth setup-git
branch=codex/update-icons
# 専用のbotブランチ。取得したheadをleaseにして並行更新を上書きしない。
old_head=$(git ls-remote origin "refs/heads/$branch" | cut -f1)
if [[ -n "$old_head" ]]; then
  git fetch origin "refs/heads/$branch:refs/remotes/origin/$branch"
  if git diff --quiet "origin/$branch" -- src/assets docs/assets.md docs/service-icons.md docs/regions.md; then
    echo '既存の更新PRと同じ内容です。'
    exit 0
  fi
fi
git switch -C "$branch"
git config user.name 'omnodi icon updater'
git config user.email 'icon-updater@users.noreply.github.com'
git add src/assets docs/assets.md docs/service-icons.md docs/regions.md
git commit -m 'chore: update bundled icons'
git push --force-with-lease="refs/heads/$branch:$old_head" origin "HEAD:refs/heads/$branch"
body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT
cat > "$body_file" <<'MD'
同梱済みのアイコンを公式配布物・安定版カタログから収集し、ライブラリへ適用しました。
Simple Icons のブランドカラー、公式素材の形状、国旗、ライセンス、出典・ハッシュを更新します。

検証: 型検査・Oxlint・markdownlint・Oxfmt・単体テスト・更新処理の回帰テスト・ビルドと、通常画面／オフラインHTMLのブラウザーテストが成功しました。
各社の商標条件と見た目の差分を確認してからマージしてください。
MD
pr=$(gh pr list --repo "$GH_REPO" --base "$BASE_BRANCH" --head "$branch" --state open --json number --jq '.[0].number // empty')
if [[ -n "$pr" ]]; then
  gh pr edit "$pr" --repo "$GH_REPO" --body-file "$body_file"
else
  gh pr create --repo "$GH_REPO" --base "$BASE_BRANCH" --head "$branch" --title 'chore: 同梱アイコンを最新版へ更新' --body-file "$body_file"
fi

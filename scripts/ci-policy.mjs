import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ブラウザーに影響しない既知のファイルだけを除外する。未知のファイルは検証する。
export function needsBrowser(files) {
  const staticFiles = new Set([
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    'renovate.json5',
    'rulesync.jsonc',
    '.github/copilot-instructions.md',
    '.github/workflows/update-icons.yml',
    '.oxlintrc.json',
    '.oxfmtrc.json',
    'scripts/lint-markdown.mjs',
    'scripts/update-icons.py',
    'scripts/publish-icon-update.sh',
    'tests/update-icons.test.py',
  ]);
  return files.some(
    (file) =>
      !staticFiles.has(file) &&
      !['docs/', '.rulesync/', '.cursor/rules/'].some((prefix) => file.startsWith(prefix)) &&
      !/^tests\/[^/]+\.test\.(?:ts|mjs)$/.test(file),
  );
}

export function workflowSucceeded({ changes, checks, browser, browserRequired }) {
  return (
    changes === 'success' &&
    checks === 'success' &&
    ((browserRequired === 'true' && browser === 'success') ||
      (browserRequired === 'false' && browser === 'skipped'))
  );
}

export function changedFiles(base, head, event) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(head ?? '')) {
    throw new Error('変更判定には完全なコミット SHA が必要です');
  }
  if (!['pull_request', 'push'].includes(event)) throw new Error('未対応の CI イベントです');
  // 初回 push は比較元がないため、ブラウザー検証を省略しない。
  if (/^0{40}$/.test(base)) return null;
  const range = event === 'pull_request' ? [`${base}...${head}`] : [base, head];
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', ...range, '--'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv[2] === 'changes') {
    const files = changedFiles(process.env.BASE_SHA, process.env.HEAD_SHA, process.env.EVENT_NAME);
    console.log(`browser=${files === null || needsBrowser(files)}`);
  } else if (process.argv[2] === 'result') {
    const passed = workflowSucceeded({
      changes: process.env.CHANGES_RESULT,
      checks: process.env.CHECKS_RESULT,
      browser: process.env.BROWSER_RESULT,
      browserRequired: process.env.BROWSER_REQUIRED,
    });
    if (!passed) {
      console.error('必要な CI ジョブが成功していません');
      process.exitCode = 1;
    }
  } else {
    throw new Error('changes または result を指定してください');
  }
}

import { traceValueFlow } from './value-flow.js';
import { createModuleResolver } from './module-resolution.js';
import { inspectSource, resolveLocal } from './source-analysis.js';
import { analyzeRepository } from './repository-analysis.js';
import type { RepositorySnapshot } from './contract.js';
export function parseRepositoryURL(raw: string): { owner: string; repo: string; url: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('GitHubリポジトリのHTTPS URLを指定してください。');
  }
  const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    parts.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
  )
    throw new Error(
      'https://github.com/owner/repository の形式で指定してください。branchや対象フォルダーは別欄に入力できます。',
    );
  const repo = parts[1].replace(/\.git$/, '');
  if (!repo) throw new Error('リポジトリ名がありません。');
  return { owner: parts[0], repo, url: `https://github.com/${parts[0]}/${repo}` };
}
function rootPath(root: string): string {
  const clean = root
    .trim()
    .replace(/^\.\/$/, '')
    .replace(/\/$/, '');
  if (clean === '.') return '';
  if (
    clean.includes('\\') ||
    clean.startsWith('/') ||
    clean.split('/').some((part) => part === '..' || part === '.') ||
    clean.includes('\0')
  )
    throw new Error('対象フォルダーはリポジトリ内の相対パスです。');
  return clean;
}
export function redactSource(source: string): string {
  return source
    .replace(
      /-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g,
      '[PRIVATE KEY REDACTED]',
    )
    .replace(
      /((?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'])[^"'\n]+/gi,
      '$1[REDACTED]',
    );
}
function repositoryPathAllowed(file: string): boolean {
  return !/(^|\/)(?:\.git|node_modules|vendor|dist|build|\.terraform)\/|(?:\.tfstate|\.tfvars|\.env|lock\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.pem|\.key)(?:$|\.)/i.test(
    file,
  );
}
export function repositoryFilePriority(file: string): number {
  if (!repositoryPathAllowed(file)) return 99;
  if (/\.infra$/i.test(file)) return 0;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file)) return 1;
  if (/(^|\/)wrangler\.(?:jsonc?|toml)$/i.test(file)) return 1;
  if (/(^|\/)(?:package|tsconfig)(?:\.[^/]*)?\.json$/i.test(file)) return 1;
  if (/(^|\/)README[^/]*\.md$/i.test(file)) return 3;
  if (
    /\.tf$/i.test(file) &&
    !/(?:backend|providers|variables|outputs|mock|test)[^/]*\.tf$/i.test(file) &&
    !/(?:^|\/)(tests|fixtures)\//i.test(file)
  )
    return 2;
  if (/(^|\/)(Dockerfile|(?:docker-)?compose[^/]*\.ya?ml)$/i.test(file)) return 2;
  if (/\.ya?ml$/i.test(file) && /(k8s|kubernetes|infra|deploy|helm)/i.test(file)) return 3;
  if (/(^|\/)package\.json$/i.test(file)) return 4;
  if (/\.[cm]?[jt]s$/i.test(file) && /(infra|stack|construct|cdk|server|app)/i.test(file)) return 5;
  return 99;
}
/** GitHubの読み取りAPIだけを利用し、コードやREADMEは実行しない。 */
export async function loadRepository(
  raw: string,
  ref = '',
  root = '',
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  token = '',
): Promise<RepositorySnapshot> {
  const { owner, repo, url } = parseRepositoryURL(raw),
    prefix = rootPath(root);
  if (token.length > 1000 || [...token].some((char) => char.charCodeAt(0) < 32))
    throw new Error('GitHubトークンの形式を確認してください。');
  if (ref.length > 200 || [...ref].some((char) => char.charCodeAt(0) < 32))
    throw new Error('branch/commitを確認してください。');
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const request = async (path: string): Promise<Record<string, unknown>> => {
    const response = await fetcher(base + path, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok)
      throw new Error(
        response.status === 403 || response.status === 429
          ? 'GitHub APIの利用上限に達しました。時間をおいて再試行してください。'
          : response.status === 401
            ? 'GitHubの認証が必要です。ローカルでは gh auth login、静的画面では読み取り用トークンを使用してください。'
            : response.status === 404
              ? 'リポジトリ・branch・対象フォルダーとGitHubの読み取り権限を確認してください。'
              : `GitHubの読み込みに失敗しました (${response.status})。`,
      );
    return (await response.json()) as Record<string, unknown>;
  };
  const info = await request('');
  const branch = ref.trim() || String(info.default_branch ?? 'main');
  const commit = await request(`/commits/${encodeURIComponent(branch)}`);
  const commitId = String(commit.sha ?? '');
  if (!/^[\da-f]{40,64}$/.test(commitId)) throw new Error('GitHubのcommitを確認できませんでした。');
  const tree = await request(`/git/trees/${commitId}?recursive=1`);
  const warnings: string[] = [];
  if (tree.truncated)
    warnings.push('GitHubのファイル一覧が途中までです。対象フォルダーを絞ってください。');
  const entries = (Array.isArray(tree.tree) ? tree.tree : [])
    .filter((item): item is { path: string; size: number; sha: string } => {
      const file = item as Record<string, unknown>;
      return (
        file.type === 'blob' &&
        file.mode !== '120000' &&
        typeof file.path === 'string' &&
        typeof file.size === 'number' &&
        file.size <= 96000 &&
        typeof file.sha === 'string' &&
        /^[\da-f]{40,64}$/.test(file.sha) &&
        !file.path.includes('\\') &&
        !file.path.split('/').includes('..') &&
        (!prefix || file.path.startsWith(prefix + '/')) &&
        repositoryPathAllowed(file.path) &&
        (repositoryFilePriority(file.path) < 99 ||
          /\.[cm]?[jt]sx?$|\.jsonc?$|\.ya?ml$|\.toml$/i.test(file.path))
      );
    })
    .sort(
      (a, b) =>
        repositoryFilePriority(a.path) - repositoryFilePriority(b.path) ||
        a.path.localeCompare(b.path),
    );
  const candidates = new Map(entries.map((entry) => [entry.path, entry]));
  const paths = new Set(candidates.keys());
  const queue = entries
    .filter((entry) => repositoryFilePriority(entry.path) <= 2)
    .map((entry) => entry.path);
  const fallback = entries
    .filter(
      (entry) => repositoryFilePriority(entry.path) > 2 && repositoryFilePriority(entry.path) < 99,
    )
    .map((entry) => entry.path);
  const ranks = new Map(queue.map((path) => [path, 0]));
  const visited = new Set<string>();
  let totalBytes = 0;
  const files: RepositorySnapshot['files'] = [];
  let flowRounds = 0;
  while ((queue.length || fallback.length) && files.length < 48 && totalBytes < 600000) {
    queue.sort((a, b) => (ranks.get(a) ?? 9) - (ranks.get(b) ?? 9));
    const path = queue.shift() ?? fallback.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const file = candidates.get(path)!;
    if (totalBytes + file.size > 600000) {
      warnings.push(`${path}: 全体の読み取り上限により省略しました。`);
      continue;
    }
    const blob = await request(`/git/blobs/${file.sha}`);
    if (
      blob.encoding !== 'base64' ||
      typeof blob.content !== 'string' ||
      blob.content.length > 140000
    )
      continue;
    const binary = atob(blob.content.replace(/\s/g, ''));
    const content = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    const loaded = { path: file.path, content: redactSource(content) };
    files.push(loaded);
    totalBytes += file.size;
    const inspected = inspectSource(loaded);
    warnings.push(...inspected.warnings);
    const resolver = createModuleResolver(files, paths);
    warnings.push(...resolver.warnings);
    // 設定が後から読まれた場合にも別名importを再評価する。
    const pending = inspected.config
      ? files.flatMap((loaded) =>
          inspectSource(loaded).references.map((reference) => ({ reference, from: loaded.path })),
        )
      : inspected.references.map((reference) => ({ reference, from: file.path }));
    const dependencies = pending.flatMap(({ reference, from }) => {
      if (
        (reference.kind === 'import' || reference.kind === 'type') &&
        !reference.target.startsWith('.') &&
        !resolver.isAlias(from, reference.target) &&
        !resolver.resolve(from, reference.target)
      )
        return [];
      const resolved =
        reference.kind === 'import' || reference.kind === 'type' || reference.kind === 'config'
          ? resolver.resolve(from, reference.target)
          : resolveLocal(from, reference.target, paths);
      if (!resolved) {
        if (
          reference.target.startsWith('.') ||
          reference.kind !== 'import' ||
          resolver.isAlias(from, reference.target)
        )
          warnings.push(`${from}: 参照先を取得できませんでした（${reference.kind}）。`);
        return [];
      }
      const rank =
        reference.kind === 'config'
          ? 0
          : reference.kind === 'entry'
            ? 1
            : reference.kind === 'action'
              ? 2
              : reference.kind === 'script' && !/package\.json$/.test(file.path)
                ? 2
                : reference.kind === 'import'
                  ? 3
                  : 4;
      ranks.set(resolved, Math.min(ranks.get(resolved) ?? 9, rank));
      return visited.has(resolved) ? [] : [resolved];
    });
    queue.push(...dependencies);
    if (!queue.length && flowRounds++ < 4) {
      const entryRoots = files.flatMap((loaded) =>
        inspectSource(loaded)
          .references.filter((ref) => ref.kind === 'entry' || ref.kind === 'script')
          .flatMap((ref) => {
            const path = resolveLocal(loaded.path, ref.target, paths);
            return path ? [path] : [];
          }),
      );
      const roots = [...new Set(entryRoots)];
      if (roots.length > 16) warnings.push('動的参照の入口は16件まで追跡します。');
      for (const root of roots.slice(0, 16)) {
        const traced = traceValueFlow(files, root, paths);
        warnings.push(...traced.warnings);
        const dynamicResolver = createModuleResolver(files, paths);
        for (const item of traced.references) {
          const target = dynamicResolver.resolve(item.file, item.reference.target);
          if (target && !visited.has(target)) {
            ranks.set(target, 3);
            queue.push(target);
          }
        }
      }
    }
  }
  if (!files.length)
    throw new Error(
      '構成に関連するファイルがありません。対象フォルダーを確認してください（.infra / .tf / README / compose / CDKなど）。',
    );
  if (queue.length || fallback.length)
    warnings.push('最大48ファイル・合計600KBの上限に達したため、一部の依存先が未解析です。');
  warnings.push(
    'ソースからの設計情報です。実環境の稼働状態・通信成立を確認した結果ではありません。',
  );
  const snapshot = {
    url,
    name: `${owner}/${repo}`,
    ref: branch,
    commit: commitId,
    files,
    warnings: [...new Set(warnings)],
  };
  return { ...snapshot, analysis: analyzeRepository(snapshot) };
}

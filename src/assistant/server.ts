import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadRepository } from './repository.js';
const exec = promisify(execFile);
/** ghの認証をGitHub読み取りだけに使用し、認証情報はHTTP応答へ含めない。 */
export const githubCLIFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (
    url.origin !== 'https://api.github.com' ||
    !url.pathname.startsWith('/repos/') ||
    (init?.method && init.method !== 'GET')
  )
    throw new Error('GitHubリポジトリの読み取りだけを許可しています。');
  try {
    const { stdout } = await exec(
      'gh',
      ['api', url.pathname + url.search, '--method', 'GET', '--hostname', 'github.com'],
      {
        timeout: 30000,
        maxBuffer: 2000000,
        signal: init?.signal ?? undefined,
        env: { ...process.env, GH_PAGER: 'cat', GH_PROMPT_DISABLED: '1' },
      },
    );
    return new Response(stdout, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    const code = (error as { code?: string }).code;
    if (
      code === 'ENOENT' ||
      String((error as { stderr?: string }).stderr ?? '').includes('gh auth login')
    )
      return fetch(input, init);
    const stderr = String((error as { stderr?: string }).stderr ?? '');
    const status = stderr.includes('HTTP 404') ? 404 : stderr.includes('HTTP 403') ? 403 : 401;
    return new Response(JSON.stringify({ message: 'GitHubの認証・権限を確認してください。' }), {
      status,
    });
  }
};
export async function handleRepositoryRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const pathname = (req.url ?? '').split('?')[0];
  if (!['/api/repository', '/api/repository/status'].includes(pathname)) return false;
  const reply = (status: number, value: unknown): void => {
    res
      .writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      .end(JSON.stringify(value));
  };
  if (pathname.endsWith('/status') && req.method === 'GET') {
    reply(200, { available: true, authentication: 'GitHub CLI' });
    return true;
  }
  const origin = req.headers.origin;
  if (
    req.method !== 'POST' ||
    !origin ||
    origin !== `http://${req.headers.host}` ||
    !/^(?:127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '')
  ) {
    reply(403, { error: 'ローカル画面からの読み取りだけを許可しています。' });
    return true;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    let source = '';
    for await (const chunk of req) {
      source += chunk.toString();
      if (source.length > 4000) throw new Error('入力が長すぎます。');
    }
    const value = JSON.parse(source) as Record<string, unknown>;
    if (
      typeof value.url !== 'string' ||
      (value.ref !== undefined && typeof value.ref !== 'string') ||
      (value.root !== undefined && typeof value.root !== 'string')
    )
      throw new Error('URL・branch・フォルダーを確認してください。');
    const repository = await loadRepository(
      value.url,
      String(value.ref ?? ''),
      String(value.root ?? ''),
      controller.signal,
      githubCLIFetch,
    );
    reply(200, repository);
  } catch (error) {
    reply(400, {
      error: controller.signal.aborted ? '読み込みを中止しました。' : (error as Error).message,
    });
  } finally {
    clearTimeout(timeout);
  }
  return true;
}

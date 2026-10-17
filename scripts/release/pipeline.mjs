import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { fetch, AbortSignal } = globalThis;
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
export function versionInfo(version) {
  assert.equal(typeof version, 'string');
  assert.ok(version.length <= 128, 'Docker タグは128文字以内で指定してください');
  assert.match(version, semver, 'バージョンは v を付けない SemVer を指定してください');
  return { version, tag: `v${version}`, prerelease: version.includes('-') };
}
export function compareVersions(a, b) {
  const left = versionInfo(a).version.split('-');
  const right = versionInfo(b).version.split('-');
  const aa = left[0].split('.').map(BigInt);
  const bb = right[0].split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  const ap = a.slice(left[0].length + 1);
  const bp = b.slice(right[0].length + 1);
  if (!ap || !bp) return ap === bp ? 0 : !ap ? 1 : -1;
  const ai = ap.split('.');
  const bi = bp.split('.');
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    if (ai[i] === undefined) return -1;
    if (bi[i] === undefined) return 1;
    if (ai[i] === bi[i]) continue;
    const an = /^\d+$/.test(ai[i]);
    const bn = /^\d+$/.test(bi[i]);
    if (an && bn) return BigInt(ai[i]) > BigInt(bi[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ai[i] > bi[i] ? 1 : -1;
  }
  return 0;
}
export function context(env = process.env) {
  const info = versionInfo(env.RELEASE_VERSION);
  assert.match(env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  return {
    ...info,
    repo: env.GITHUB_REPOSITORY,
    sha: env.GITHUB_SHA,
    image: `ghcr.io/${env.GITHUB_REPOSITORY.toLowerCase()}`,
  };
}
export function githubClient(repo, token, fetchImpl = fetch) {
  assert.ok(token, 'GH_TOKEN が必要です');
  return async (path, options = {}) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && options.optional) return null;
    // 応答本文・認証情報はログに出さない。通信エラーを「未公開」と解釈しない。
    assert.ok(response.ok, `GitHub API ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}
export function anonymousRegistry(repo, fetchImpl = fetch) {
  const name = repo.toLowerCase();
  let bearer;
  const get = async (kind, ref, optional = false) => {
    if (!bearer) {
      const auth = await fetchImpl(
        `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${name}:pull`)}`,
        { signal: AbortSignal.timeout(30000) },
      );
      assert.ok(
        auth.ok,
        `GHCR 匿名認証: HTTP ${auth.status}。パッケージの Public 設定を確認してください`,
      );
      bearer = (await auth.json()).token;
      assert.ok(bearer);
    }
    const response = await fetchImpl(`https://ghcr.io/v2/${name}/${kind}/${ref}`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept:
          'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && optional) return null;
    assert.ok(response.ok, `GHCR ${kind}/${ref}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digestPattern.test(ref)) assert.equal(digest, ref, '取得内容と指定 digest が一致しません');
    const advertised = response.headers.get('docker-content-digest');
    if (advertised) assert.equal(digest, advertised, 'レジストリーの digest が一致しません');
    return { digest, value: JSON.parse(bytes.toString('utf8')) };
  };
  return {
    manifest: (ref, optional) => get('manifests', ref, optional),
    blob: (ref) => get('blobs', ref),
  };
}
export async function inspectImage(registry, ref, expected, optional = false) {
  const index = await registry.manifest(ref, optional);
  if (!index) return null;
  const platforms = index.value.manifests?.filter(
    (m) => m.platform?.os !== 'unknown' || m.platform?.architecture !== 'unknown',
  );
  assert.ok(platforms, 'multi-arch index が必要です');
  assert.deepEqual(
    platforms.map((m) => `${m.platform?.os}/${m.platform?.architecture}`).sort(),
    ['linux/amd64', 'linux/arm64'],
    '両 CPU のイメージが一つずつ必要です',
  );
  let metadata;
  for (const platform of platforms) {
    assert.match(platform.digest, digestPattern);
    const manifest = await registry.manifest(platform.digest);
    assert.match(manifest.value.config.digest, digestPattern);
    const config = (await registry.blob(manifest.value.config.digest)).value;
    assert.equal(config.architecture, platform.platform.architecture);
    assert.equal(config.os, 'linux');
    const labels = config.config?.Labels ?? {};
    const current = {
      version: versionInfo(labels['org.opencontainers.image.version']).version,
      sha: labels['org.opencontainers.image.revision'],
    };
    assert.match(current.sha ?? '', /^[a-f0-9]{40}$/);
    if (metadata) assert.deepEqual(current, metadata, 'CPU 間で版・リビジョンが一致しません');
    metadata = current;
    if (expected) {
      assert.equal(current.version, expected.version, '公開済みイメージの版が一致しません');
      assert.equal(current.sha, expected.sha, '公開済みイメージのリビジョンが一致しません');
    }
  }
  return { digest: index.digest, ...metadata };
}
async function tagCommit(api, tag) {
  let object = (await api(`git/ref/tags/${tag}`, { optional: true }))?.object;
  for (let depth = 0; object?.type === 'tag'; depth++) {
    assert.ok(depth < 5, 'タグの参照が深すぎます');
    object = (await api(`git/tags/${object.sha}`)).object;
  }
  if (object) assert.equal(object.type, 'commit');
  return object?.sha;
}
export async function prepare(ctx, { api, read = (path) => readFileSync(path, 'utf8') }) {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.version, ctx.version, 'package.json の版をリリース用 PR で更新してください');
  assert.equal(lock.version, ctx.version);
  assert.equal(lock.packages[''].version, ctx.version);
  const notes = read(`docs/release-notes-${ctx.tag}.md`);
  assert.ok(
    notes.includes(`# Infra Canvas ${ctx.tag}`) && /[ぁ-んァ-ヶ一-龠]/.test(notes),
    '日本語のリリースノートが必要です',
  );
  for (const workflow of ['ci.yml', 'docker.yml']) {
    const result = await api(
      `actions/workflows/${workflow}/runs?head_sha=${ctx.sha}&branch=main&event=push&per_page=100`,
    );
    const latest = result.workflow_runs[0];
    assert.ok(
      latest?.head_sha === ctx.sha &&
        latest.head_branch === 'main' &&
        latest.event === 'push' &&
        latest.status === 'completed' &&
        latest.conclusion === 'success',
      `${workflow}: 対象 SHA の main CI が成功してから実行してください`,
    );
  }
  const existing = await tagCommit(api, ctx.tag);
  if (existing) assert.equal(existing, ctx.sha, '同名タグが別 SHA を指しています。上書きしません');
  else
    await api('git/refs', { method: 'POST', body: { ref: `refs/tags/${ctx.tag}`, sha: ctx.sha } });
  return ctx;
}
export function releaseBody(ctx, digest, notes) {
  assert.match(digest, digestPattern);
  return `${notes.trim()}\n\n## Docker で起動する\n\n\`\`\`bash\ndocker run --rm --name infra-canvas -p 127.0.0.1:5180:5180 ${ctx.image}:${ctx.version}\n\`\`\`\n\n<http://127.0.0.1:5180/> を開いてください。終了は Ctrl+C、編集結果は「DSL を保存」でダウンロードできます。\n\n## 対応環境・検証結果\n\n- linux/arm64・linux/amd64 に対応し、Docker が CPU に合うイメージを選択します。\n- 両 CPU のネイティブ GitHub-hosted runner で、GHCR から匿名 pull した digest 固定イメージの起動・HTTP・API 保護・非 root・図の編集・DSL 保存/読み込み・healthcheck・読み取り専用マウントを検証しました。\n- CLI の PNG/PDF 用 Chromium は同梱しません。ブラウザーからの PNG 出力・印刷を利用できます。\n- イメージ digest: \`${digest}\`\n- ソース: [${ctx.sha}](https://github.com/${ctx.repo}/commit/${ctx.sha})\n- [使い方・ライセンス](https://github.com/${ctx.repo}/blob/${ctx.tag}/README.md)\n\n<!-- infra-canvas-release ${ctx.tag} ${ctx.sha} ${digest} -->\n`;
}
export async function finalize(
  ctx,
  digest,
  { api, registry, promote, read = (path) => readFileSync(path, 'utf8') },
) {
  assert.equal(await tagCommit(api, ctx.tag), ctx.sha, 'タグが変更されています');
  const image = await inspectImage(registry, ctx.version, ctx);
  assert.equal(image.digest, digest, '検証後にバージョンタグの digest が変更されています');
  const body = releaseBody(ctx, digest, read(`docs/release-notes-${ctx.tag}.md`));
  const marker = `<!-- infra-canvas-release ${ctx.tag} ${ctx.sha} ${digest} -->`;
  const existing = await api(`releases/tags/${ctx.tag}`, { optional: true });
  if (existing) {
    assert.ok(
      existing.body?.includes(marker),
      '既存 Release のソース・digest を確認できません。上書きしません',
    );
    assert.equal(existing.prerelease, ctx.prerelease);
    if (!existing.draft) return existing;
  }
  if (!ctx.prerelease) {
    const latest = await inspectImage(registry, 'latest', undefined, true);
    if (latest) {
      assert.ok(!versionInfo(latest.version).prerelease, 'latest がプレリリースを指しています');
      assert.ok(
        compareVersions(ctx.version, latest.version) >= 0,
        'latest のダウングレードを拒否しました',
      );
      if (latest.version === ctx.version)
        assert.equal(latest.digest, digest, '同じ版の latest が別 digest を指しています');
    }
    if (latest?.digest !== digest) {
      await promote(`${ctx.image}@${digest}`, `${ctx.image}:latest`);
      assert.equal(
        (await inspectImage(registry, 'latest', ctx)).digest,
        digest,
        'latest 更新結果が一致しません',
      );
    }
  }
  const fields = {
    tag_name: ctx.tag,
    name: `Infra Canvas ${ctx.tag}`,
    body,
    draft: false,
    prerelease: ctx.prerelease,
    make_latest: ctx.prerelease ? 'false' : 'true',
  };
  return api(existing ? `releases/${existing.id}` : 'releases', {
    method: existing ? 'PATCH' : 'POST',
    body: fields,
  });
}
export async function run(command, env = process.env) {
  const ctx = context(env);
  const output = (values) => {
    assert.ok(env.GITHUB_OUTPUT, 'GITHUB_OUTPUT が必要です');
    appendFileSync(
      env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  };
  if (command === 'prepare') {
    assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(env.GITHUB_REF, 'refs/heads/main', 'main からのみ実行できます');
    await prepare(ctx, { api: githubClient(ctx.repo, env.GH_TOKEN) });
    output(ctx);
  } else if (command === 'plan' || command === 'verify') {
    const image = await inspectImage(
      anonymousRegistry(ctx.repo),
      ctx.version,
      ctx,
      command === 'plan',
    );
    if (command === 'verify') {
      assert.match(env.IMAGE_DIGEST ?? '', digestPattern);
      assert.equal(image.digest, env.IMAGE_DIGEST, '配布・検証対象の digest が一致しません');
    } else output({ exists: Boolean(image), digest: image?.digest ?? '' });
  } else if (command === 'finalize') {
    assert.match(env.IMAGE_DIGEST ?? '', digestPattern);
    const result = await finalize(ctx, env.IMAGE_DIGEST, {
      api: githubClient(ctx.repo, env.GH_TOKEN),
      registry: anonymousRegistry(ctx.repo),
      promote: (source, target) =>
        execFileSync('docker', ['buildx', 'imagetools', 'create', '--tag', target, source], {
          stdio: 'inherit',
        }),
    });
    console.log(result.html_url);
  } else throw new Error('prepare / plan / verify / finalize を指定してください');
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  await run(process.argv[2]);
}

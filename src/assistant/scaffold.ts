import { parseConfig } from './source-analysis.js';
import { analyzeRepository } from './repository-analysis.js';
export { parseJSONC } from './jsonc.js';
import { repositoryRelationships } from './relationships.js';
import type { Diagram, Resource } from '../core/model.js';
import { serializeDSL } from '../core/serialize.js';
import { validateDiagram } from '../core/validate.js';
import type { RepositorySnapshot, Draft } from './contract.js';

/** コメント・文字列内の見せかけの宣言を拾わない。式の評価やコード実行は行わない。 */
export function terraformDeclarations(source: string): string[] {
  const types: string[] = [];
  let depth = 0;
  for (let i = 0; i < source.length;) {
    if (source.startsWith('//', i) || source[i] === '#') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source[i] === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i++] === '"') break;
      }
      continue;
    }
    const heredoc = /^<<-?([A-Za-z_][\w-]*)[^\n]*\n/.exec(source.slice(i));
    if (heredoc) {
      i += heredoc[0].length;
      while (i < source.length) {
        const end = source.indexOf('\n', i),
          line = source.slice(i, end < 0 ? undefined : end).trim();
        i = end < 0 ? source.length : end + 1;
        if (line === heredoc[1]) break;
      }
      continue;
    }
    if (depth === 0 && (i === 0 || /\s/.test(source[i - 1]))) {
      const match = /^resource\s+"([A-Za-z_][\w]*)"\s+"[A-Za-z_][\w-]*"\s*\{/.exec(source.slice(i));
      if (match) {
        types.push(match[1]);
        i += match[0].length;
        depth++;
        continue;
      }
    }
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth = Math.max(0, depth - 1);
    i++;
  }
  return types;
}

interface Category {
  id: string;
  label: string;
  provider: string;
  type?: string;
  icon?: string;
  files: Set<string>;
}
const providerLabels: Record<string, string> = {
  cloudflare: 'Cloudflare',
  google: 'Google Cloud',
  turso: 'Turso',
  discord: 'Discord',
  aws: 'AWS',
  azurerm: 'Azure',
  resend: 'Resend',
  github: 'GitHub',
  onepassword: '1Password',
};
const providerIcons: Record<string, string> = {
  cloudflare: 'saas.cloudflare',
  discord: 'saas.discord',
  turso: 'saas.turso',
  github: 'github.actions',
  onepassword: 'saas.1password',
  aws: 'aws.organization-account',
  resend: 'saas.resend',
};
export function discordNotificationSources(snapshot: RepositorySnapshot): string[] {
  const analysis = snapshot.analysis ?? analyzeRepository(snapshot);
  return [
    ...new Set(
      analysis.relations
        .filter((relation) => relation.kind === 'notification')
        .flatMap((relation) => relation.evidence.map((item) => item.file)),
    ),
  ];
}
/** 宣言された種別・設定バインディングだけの概要。通信成立や変数の値を推定しない。 */
export function repositoryScaffold(snapshot: RepositorySnapshot): Draft | undefined {
  const categories = new Map<string, Category>();
  const bindings = new Set<string>();
  const warnings: string[] = [...(snapshot.analysis?.diagnostics ?? [])];
  const add = (
    id: string,
    label: string,
    provider: string,
    file: string,
    type = 'external.service',
    icon?: string,
  ) => {
    const existing = categories.get(id);
    if (existing) existing.files.add(file);
    else categories.set(id, { id, label, provider, type, icon, files: new Set([file]) });
  };
  const notifications = discordNotificationSources(snapshot);
  const relationships = repositoryRelationships(snapshot);
  for (const file of new Set([...relationships.secrets, ...relationships.workerSecrets]))
    add(
      'onepassword',
      '1Password（シークレット取得元）',
      'onepassword',
      file,
      undefined,
      'saas.1password',
    );
  for (const file of relationships.turso)
    add('turso_settings', 'Turso DB（接続設定）', 'turso', file, undefined, 'saas.turso');
  for (const file of snapshot.files) {
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file.path))
      add(
        'github_actions',
        'GitHub Actions（ワークフロー）',
        'github',
        file.path,
        'github.actions',
        'github.actions',
      );
    if (/\.tf$/i.test(file.path)) {
      for (const type of terraformDeclarations(file.content)) {
        const provider = type.split('_')[0];
        if (!Object.hasOwn(providerLabels, provider)) continue;
        if (provider === 'cloudflare') {
          if (/queue/.test(type))
            add(
              'cf_queue',
              'Queues（宣言・設定）',
              provider,
              file.path,
              undefined,
              'saas.cloudflare',
            );
          else if (/dns|zone/.test(type))
            add('cf_dns', 'DNS・Zone設定', provider, file.path, undefined, 'saas.cloudflare');
          else
            add(
              'cf_other',
              'Cloudflare設定（集約）',
              provider,
              file.path,
              undefined,
              'saas.cloudflare',
            );
        } else if (provider === 'aws') {
          const mapping: Record<string, [string, string, string]> = {
            aws_instance: ['aws_ec2', 'EC2（宣言）', 'aws.ec2'],
            aws_lb: ['aws_alb', 'ALB（宣言）', 'aws.alb'],
            aws_db_instance: ['aws_db', 'RDS（宣言）', 'aws.rds'],
            aws_s3_bucket: ['aws_s3', 'S3（宣言）', 'aws.s3'],
            aws_lambda_function: ['aws_lambda', 'Lambda（宣言）', 'aws.lambda'],
            aws_security_group: ['aws_sg', 'SG（宣言・ルール未解析）', 'sg'],
          };
          const mapped = mapping[type];
          if (mapped) add(mapped[0], mapped[1], provider, file.path, mapped[2]);
          else add('aws_other', 'AWS設定（集約）', provider, file.path);
        } else
          add(
            provider + '_settings',
            providerLabels[provider] + '設定（宣言・集約）',
            provider,
            file.path,
            undefined,
            provider === 'discord'
              ? 'saas.discord'
              : provider === 'turso'
                ? 'saas.turso'
                : provider === 'resend'
                  ? 'saas.resend'
                  : undefined,
          );
      }
    }
    if (/(^|\/)wrangler\.(?:jsonc?|toml)$/i.test(file.path)) {
      try {
        const config = parseConfig(file);
        if (
          typeof config.name !== 'string' ||
          (!config.main && !config.assets && !config.pages_build_output_dir)
        )
          continue;
        add(
          'cf_app',
          config.pages_build_output_dir ? 'Pagesアプリ（設定）' : 'Workersアプリ（設定）',
          'cloudflare',
          file.path,
          undefined,
          'saas.cloudflare',
        );
        const configs = [
          config,
          ...Object.values(
            (config.env && typeof config.env === 'object' ? config.env : {}) as Record<
              string,
              unknown
            >,
          ).filter(
            (value): value is Record<string, unknown> =>
              !!value && typeof value === 'object' && !Array.isArray(value),
          ),
        ];
        for (const item of configs) {
          const queues = item.queues as
            | { producers?: unknown[]; consumers?: unknown[] }
            | undefined;
          if (
            (Array.isArray(queues?.producers) && queues.producers.length) ||
            (Array.isArray(queues?.consumers) && queues.consumers.length)
          ) {
            add(
              'cf_queue',
              'Queues（宣言・設定）',
              'cloudflare',
              file.path,
              undefined,
              'saas.cloudflare',
            );
            bindings.add('cf_queue');
          }
          for (const [key, id, label] of [
            ['d1_databases', 'cf_d1', 'D1バインディング（開発を含む）'],
            ['kv_namespaces', 'cf_kv', 'KVバインディング'],
            ['r2_buckets', 'cf_r2', 'R2バインディング'],
          ])
            if (Array.isArray(item[key]) && item[key].length) {
              add(id, label, 'cloudflare', file.path, undefined, 'saas.cloudflare');
              bindings.add(id);
            }
        }
      } catch {
        warnings.push(`${file.path} の設定を解析できませんでした。`);
      }
    }
  }
  for (const file of notifications)
    add(
      'discord_notifications',
      'Discord通知（Webhook）',
      'discord',
      file,
      undefined,
      'saas.discord',
    );
  for (const file of relationships.workerSecrets) categories.get('cf_app')?.files.add(file);
  if (!categories.size) return undefined;
  const selected: Category[] = [];
  const providers = new Set<string>();
  // バインディングの起点を最優先にする。
  const sorted = [...categories.values()].sort((a, b) =>
    a.id === 'cf_app' ? -1 : b.id === 'cf_app' ? 1 : 0,
  );
  for (const category of sorted) {
    const extra = providers.has(category.provider) ? 1 : 2;
    if (selected.length + providers.size + extra > 20) {
      warnings.push('概要の20要素を超える種別は省略しました。');
      continue;
    }
    selected.push(category);
    providers.add(category.provider);
  }
  const provenance = { kind: 'static' as const, repository: snapshot.url, commit: snapshot.commit };
  const resources: Resource[] = [...providers].map((provider) => ({
    id: 'repo_provider_' + provider,
    type: 'group',
    label: providerLabels[provider] + '（設定の分類）',
    attributes: {
      provider,
      evidence: 'inferred',
      ...(providerIcons[provider] ? { icon: providerIcons[provider] } : {}),
    },
    provenance,
  }));
  resources.push(
    ...selected.map((category) => ({
      id: 'repo_' + category.id,
      type: category.type!,
      label: category.label,
      parentId: 'repo_provider_' + category.provider,
      attributes: {
        evidence: 'inferred',
        ...(category.icon ? { icon: category.icon } : {}),
        'meta.sources': [...category.files].join(', '),
      },
      provenance,
    })),
  );
  const connections: Diagram['connections'] = resources.some(
    (resource) => resource.id === 'repo_cf_app',
  )
    ? [...bindings]
        .filter((id) => resources.some((resource) => resource.id === 'repo_' + id))
        .map((id, index) => ({
          id: 'repo_binding_' + index,
          source: 'repo_cf_app',
          target: 'repo_' + id,
          kind: 'association',
          attributes: { label: '設定上のバインディング', evidence: 'inferred' },
        }))
    : [];
  if (
    notifications.length &&
    resources.some((r) => r.id === 'repo_github_actions') &&
    resources.some((r) => r.id === 'repo_discord_notifications')
  )
    connections.push({
      id: 'repo_discord_notification',
      source: 'repo_github_actions',
      target: 'repo_discord_notifications',
      kind: 'dependency',
      attributes: {
        label: 'Discord通知（Webhook POST定義）',
        evidence: 'inferred',
      },
    });
  for (const relation of [
    {
      id: 'repo_cloudflare_deployment',
      source: 'repo_github_actions',
      target: 'repo_cf_app',
      kind: 'deploy' as const,
      label: 'Wranglerデプロイ（コード定義）',
      files: relationships.deployment,
    },
    {
      id: 'repo_turso_connection',
      source: 'repo_cf_app',
      target: 'repo_turso_settings',
      kind: 'dependency' as const,
      label: 'Turso接続（環境条件あり）',
      files: relationships.turso,
    },
    {
      id: 'repo_worker_secret_sync',
      source: 'repo_onepassword',
      target: 'repo_cf_app',
      kind: 'dependency' as const,
      label: 'シークレット同期（GitHub Actions経由）',
      files: relationships.workerSecrets,
    },
    {
      id: 'repo_secret_supply',
      source: 'repo_onepassword',
      target: 'repo_github_actions',
      kind: 'dependency' as const,
      label: 'シークレット供給（load-secrets-action）',
      files: relationships.secrets,
    },
  ])
    if (
      relation.files.length &&
      resources.some((r) => r.id === relation.source) &&
      resources.some((r) => r.id === relation.target)
    )
      connections.push({
        id: relation.id,
        source: relation.source,
        target: relation.target,
        kind: relation.kind,
        attributes: { label: relation.label, evidence: 'inferred' },
      });
  const diagram = validateDiagram({
    version: 1,
    title: snapshot.name + ' — 宣言からの概要',
    resources,
    connections,
    views: [{ id: 'service', level: 'resource', direction: 'RIGHT' }],
    diagnostics: [],
  });
  warnings.push(
    'Terraform/Wranglerの宣言を分類した概要です。変数・式・モジュール・個別権限・環境差分は未評価です。バインディングと検出した通知・デプロイ・DB接続・シークレット取得定義以外の通信経路は推定していません。設定・ワークフロー・import先のASTから静的な候補を検出しています。動的呼び出し・完全なデータフロー・実行条件・実行結果は未評価です。',
  );
  return {
    diagram,
    dsl: serializeDSL(diagram),
    message: '宣言・バインディングから構成の概要を作成しました。',
    warnings: [...new Set([...snapshot.warnings, ...warnings])],
  };
}

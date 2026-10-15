import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/** 全ワーカーから読み込むHTMLは一度だけ生成し、並列での書き込み競合を避ける。 */
export default function globalSetup(): void {
  mkdirSync('artifacts', { recursive: true });
  for (const name of [
    'proxies',
    'observability',
    'organizations',
    'aws',
    'ecs-beanstalk',
    'transit-vpn',
    'saas',
    'service-catalog',
    'identity',
    'gcp-web',
    'gcp-analytics',
    'azure-web',
    'azure-functions',
    'architecture',
    'expressions',
  ]) {
    execFileSync(process.execPath, [
      'dist/cli.js',
      'html',
      `examples/${name}.infra`,
      '--out',
      `artifacts/${name}.html`,
    ]);
  }
  // fullyParallel の beforeAll は複数ワーカーで再実行されるため、共有出力もここで一度だけ作る。
  for (const [format, options] of [
    ['png', ['--scale', '0.5']],
    ['pdf', ['--paper', 'A3']],
  ] as const) {
    execFileSync(process.execPath, [
      'dist/cli.js',
      format,
      'examples/expressions.infra',
      '--out',
      `artifacts/expressions-cli.${format}`,
      ...options,
    ]);
  }
  execFileSync(process.execPath, [
    'dist/cli.js',
    'import',
    'examples/terraform',
    '--json',
    'fixture-plan.json',
    '--out',
    'artifacts/terraform-model.json',
    '--dsl',
    'artifacts/terraform.infra',
  ]);
}

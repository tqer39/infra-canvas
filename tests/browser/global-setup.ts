import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/** 全ワーカーから読み込むHTMLは一度だけ生成し、並列での書き込み競合を避ける。 */
export default function globalSetup(): void {
  mkdirSync('artifacts', { recursive: true });
  for (const name of [
    'observability',
    'organizations',
    'aws',
    'ecs-beanstalk',
    'transit-vpn',
    'saas',
    'service-catalog',
    'identity',
  ]) {
    execFileSync(process.execPath, [
      'dist/cli.js',
      'html',
      `examples/${name}.infra`,
      '--out',
      `artifacts/${name}.html`,
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

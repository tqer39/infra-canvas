import { traceValueFlow, type ValueFlow } from './value-flow.js';
import { createModuleResolver } from './module-resolution.js';
import type { RepositorySnapshot } from './contract.js';
import { inspectSource, resolveLocal } from './source-analysis.js';
export interface AnalysisEvidence {
  file: string;
  line: number;
  reason: string;
}
export interface AnalysisRelation {
  kind: 'deployment' | 'database' | 'notification' | 'secrets' | 'secretSync';
  source: string;
  target: string;
  evidence: AnalysisEvidence[];
  via?: string;
}
export interface RepositoryAnalysis {
  version: 1;
  dependencies: { from: string; to: string; kind: string; line: number }[];
  calls: { file: string; line: number; caller: string; callee: string; target?: string }[];
  relations: AnalysisRelation[];
  diagnostics: string[];
  flows: ValueFlow[];
}
function records(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function hasServiceURL(value: unknown, host: string, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      return url.hostname === host || url.hostname.endsWith('.' + host);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => hasServiceURL(child, host, seen));
}
export function analyzeRepository(snapshot: Pick<RepositorySnapshot, 'files'>): RepositoryAnalysis {
  const paths = new Set(snapshot.files.map((file) => file.path));
  const resolver = createModuleResolver(snapshot.files, paths);
  const infos = new Map(snapshot.files.map((file) => [file.path, inspectSource(file)]));
  const result: RepositoryAnalysis = {
    version: 1,
    dependencies: [],
    calls: [],
    relations: [],
    diagnostics: [...resolver.warnings],
    flows: [],
  };
  for (const path of infos.keys()) {
    const trace = traceValueFlow(snapshot.files, path, paths);
    result.flows.push(...trace.flows);
    result.diagnostics.push(...trace.warnings);
    for (const item of trace.calls)
      result.calls.push({
        file: item.file,
        line: item.call.line,
        caller: item.call.owner,
        callee: item.call.symbol,
      });
    for (const item of trace.references)
      if (
        !infos
          .get(item.file)
          ?.references.some(
            (ref) => ref.line === item.reference.line && ref.target === item.reference.target,
          )
      )
        infos.get(item.file)?.references.push(item.reference);
  }
  for (const [path, info] of infos) {
    result.diagnostics.push(...info.warnings);
    for (const reference of info.references) {
      if (
        (reference.kind === 'import' || reference.kind === 'type') &&
        !reference.target.startsWith('.') &&
        !resolver.isAlias(path, reference.target) &&
        !resolver.resolve(path, reference.target)
      )
        continue;
      const target =
        reference.kind === 'import' || reference.kind === 'type' || reference.kind === 'config'
          ? resolver.resolve(path, reference.target)
          : resolveLocal(path, reference.target, paths);
      if (target)
        result.dependencies.push({
          from: path,
          to: target,
          kind: reference.kind,
          line: reference.line,
        });
      else
        result.diagnostics.push(
          `${path}:${reference.line}: ${reference.kind}の参照先は未取得または未対応です。`,
        );
    }
    for (const call of info.calls) {
      const [base, member] = call.symbol.split('.');
      const imported = info.references.find((reference) => reference.symbol === base);
      const target = imported && resolver.resolve(path, imported.target);
      result.calls.push({
        file: path,
        line: call.line,
        caller: call.owner,
        callee: call.symbol,
        ...(target
          ? {
              target:
                target + '#' + (imported?.imported === '*' ? member : (imported?.imported ?? base)),
            }
          : {}),
      });
    }
  }
  const closure = (root: string): string[] => {
    const seen = new Set<string>(),
      queue = [root];
    while (queue.length && seen.size < 48) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      queue.push(
        ...result.dependencies
          .filter((edge) => edge.from === path && edge.kind === 'import')
          .map((edge) => edge.to),
      );
    }
    return [...seen];
  };
  const evidence = (path: string, reason: string, line = 1): AnalysisEvidence => ({
    file: path,
    line,
    reason,
  });
  const add = (relation: AnalysisRelation) => {
    const existing = result.relations.find(
      (item) =>
        item.kind === relation.kind &&
        item.source === relation.source &&
        item.target === relation.target,
    );
    if (existing)
      existing.evidence.push(
        ...relation.evidence.filter(
          (item) =>
            !existing.evidence.some(
              (old) =>
                old.file === item.file && old.line === item.line && old.reason === item.reason,
            ),
        ),
      );
    else result.relations.push(relation);
  };
  const commandRoots = (source: string, workingDir: string): string[] => {
    const roots: string[] = [];
    for (const match of source.matchAll(
      /(?:^|[\n;&|])[ \t]*(?:node|tsx|ts-node)[ \t]+(?:["']([^"']+)["']|([\w./-]+))/g,
    )) {
      const resolved = resolveLocal(
        (workingDir ? workingDir + '/' : '') + 'package.json',
        './' + (match[1] ?? match[2]).replace(/^\.\//, ''),
        paths,
      );
      if (resolved) roots.push(resolved);
    }
    for (const match of source.matchAll(/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:-]+)/g)) {
      const pkg = infos.get((workingDir ? workingDir + '/' : '') + 'package.json')?.config;
      const script = records(pkg?.scripts)[match[1]];
      if (typeof script === 'string')
        for (const root of commandRootsLiteral(script, workingDir, paths)) roots.push(root);
    }
    return roots;
  };
  const workflows = [...infos].filter(([path]) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path),
  );
  const visitSteps = (
    workflow: string,
    job: Record<string, unknown>,
    chain: string[] = [],
    depth = 0,
  ): void => {
    if (depth > 5) return;
    const steps = Array.isArray(job.steps) ? job.steps.map(records) : [];
    const loads = steps.filter(
      (step) =>
        typeof step.uses === 'string' &&
        /^1password\/load-secrets-action@/.test(step.uses) &&
        Object.values(records(step.env)).some(
          (value) => typeof value === 'string' && value.startsWith('op://'),
        ),
    );
    if (loads.length)
      add({
        kind: 'secrets',
        source: 'onepassword',
        target: 'github',
        evidence: [evidence(workflow, 'job内の1Password取得Action')],
      });
    const workingDir = String(
      records(records(job.defaults).run)['working-directory'] ?? '',
    ).replace(/^\.\//, '');
    for (const step of steps) {
      if (typeof step.uses === 'string' && step.uses.startsWith('./')) {
        const action = resolveLocal('package.json', step.uses.slice(2), paths);
        if (action && !chain.includes(action))
          visitSteps(
            action,
            records(infos.get(action)?.config?.runs),
            [...chain, action],
            depth + 1,
          );
      }
      if (typeof step.run !== 'string') continue;
      const dir =
        typeof step['working-directory'] === 'string'
          ? step['working-directory'].replace(/^\.\//, '')
          : workingDir;
      const roots = commandRoots(step.run, dir);
      for (const root of roots) {
        const trace = traceValueFlow(snapshot.files, root, paths);
        result.diagnostics.push(...trace.warnings);
        result.flows.push(...trace.flows);
        for (const item of trace.calls)
          result.calls.push({
            file: item.file,
            line: item.call.line,
            caller: item.call.owner,
            callee: item.call.symbol,
          });
        const traced = trace.calls.map((item) => ({
          path: item.file,
          call: item.call,
          trace: item.trace,
        }));
        const syntactic = closure(root).flatMap((path) =>
          (infos.get(path)?.calls ?? []).map((call) => ({
            path,
            call,
            trace: [] as AnalysisEvidence[],
          })),
        );
        for (const item of [...syntactic, ...traced]) {
          const { path, call } = item;
          const info = infos.get(path)!;
          {
            if (!call.commandArguments && !call.literals.includes('POST')) continue;
            const argv = call.literals;
            if (
              call.commandArguments &&
              argv.some((arg) => /(?:^|\/)wrangler(?:\/bin\/wrangler\.js)?$/.test(arg)) &&
              argv.includes('deploy')
            )
              add({
                kind: 'deployment',
                source: 'github',
                target: 'workers',
                evidence: [
                  evidence(workflow, 'run → ローカルスクリプト'),
                  ...chain.map((file) => evidence(file, 'ローカルAction')),
                  evidence(root, '呼び出しの入口'),
                  ...item.trace,
                  evidence(path, 'Wrangler deployの引数', call.line),
                ],
              });
            if (
              argv.includes('POST') &&
              info.literals.some(
                (value) => value === 'discord.com' || value.includes('discord.com/api/webhooks'),
              )
            )
              add({
                kind: 'notification',
                source: 'github',
                target: 'discord',
                evidence: [
                  evidence(workflow, 'run → ローカルスクリプト'),
                  evidence(root, '呼び出しの入口'),
                  evidence(path, 'Discord宛POSTの定義', call.line),
                ],
              });
            if (
              loads.some((load) => records(load.with)['export-env'] !== false) &&
              call.commandArguments &&
              argv.some((arg) => arg.includes('wrangler')) &&
              argv.includes('secret') &&
              argv.includes('bulk')
            )
              add({
                kind: 'secretSync',
                source: 'onepassword',
                target: 'workers',
                via: 'github',
                evidence: [
                  evidence(workflow, '同一job内の取得と同期'),
                  evidence(root, '呼び出しの入口'),
                  ...item.trace,
                  evidence(path, 'Wrangler secret bulkの引数', call.line),
                ],
              });
          }
        }
      }
      if (/\bwrangler\s+deploy\b/.test(step.run))
        add({
          kind: 'deployment',
          source: 'github',
          target: 'workers',
          evidence: [evidence(workflow, 'run内のWrangler deploy')],
        });
      if (
        loads.some((load) => records(load.with)['export-env'] !== false) &&
        /\bwrangler\s+secret\s+bulk\b/.test(step.run)
      )
        add({
          kind: 'secretSync',
          source: 'onepassword',
          target: 'workers',
          via: 'github',
          evidence: [evidence(workflow, '同一job内の取得とWrangler secret bulk')],
        });
    }
  };
  for (const [path, info] of workflows)
    for (const job of Object.values(records(info.config?.jobs))) visitSteps(path, records(job));
  for (const [path, info] of infos)
    if (/(?:^|\/)wrangler\.(?:jsonc?|toml)$/.test(path) && info.config) {
      const entry = info.references.find((ref) => ref.kind === 'entry');
      const root = entry && resolveLocal(path, entry.target, paths);
      if (!root) continue;
      const configured = hasServiceURL(info.config, 'turso.io');
      if (configured)
        for (const module of closure(root)) {
          const inspected = infos.get(module)!;
          const factories = inspected.references.filter(
            (ref) => ref.kind === 'import' && /^@libsql\//.test(ref.target),
          );
          const call = inspected.calls.find((item) =>
            factories.some(
              (factory) =>
                item.symbol === factory.symbol || item.symbol.startsWith(factory.symbol + '.'),
            ),
          );
          if (call)
            add({
              kind: 'database',
              source: 'workers',
              target: 'turso',
              evidence: [
                evidence(path, 'Turso接続先の環境設定'),
                evidence(root, '設定されたエントリー'),
                evidence(module, 'import先のlibSQLクライアント呼び出し', call.line),
              ],
            });
        }
    }
  result.diagnostics.push(
    '呼び出しとimportの静的な候補を記録しています。未確定の動的ディスパッチ・引数の完全なデータフロー・実行条件・実環境は未評価です。',
  );
  result.calls = [
    ...new Map(result.calls.map((item) => [JSON.stringify(item), item])).values(),
  ].slice(0, 12000);
  result.flows = [
    ...new Map(result.flows.map((item) => [JSON.stringify(item), item])).values(),
  ].slice(0, 6000);
  const diagnostics = [...new Set(result.diagnostics)];
  result.diagnostics = diagnostics.slice(0, 200);
  if (diagnostics.length > 200)
    result.diagnostics.push('診断は最大200件まで表示します。対象範囲を絞ると詳細を確認できます。');
  return result;
}
function commandRootsLiteral(command: string, dir: string, paths: Set<string>): string[] {
  return [
    ...command.matchAll(
      /(?:^|[\n;&|])[ \t]*(?:node|tsx|ts-node)[ \t]+(?:["']([^"']+)["']|([\w./-]+))/g,
    ),
  ].flatMap((match) => {
    const path = resolveLocal(
      (dir ? dir + '/' : '') + 'package.json',
      './' + (match[1] ?? match[2]).replace(/^\.\//, ''),
      paths,
    );
    return path ? [path] : [];
  });
}

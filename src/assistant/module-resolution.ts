import { parseJSONC } from './jsonc.js';
import type { RepositoryFile } from './contract.js';
export function normalizePath(from: string, target: string): string | undefined {
  if (
    !target ||
    target.startsWith('/') ||
    target.includes('\\') ||
    target.includes('\0') ||
    /^[a-z]:/i.test(target)
  )
    return;
  const parts = from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') {
      if (!parts.length) return;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
export function findModule(base: string, paths: ReadonlySet<string>): string | undefined {
  return [
    ...(/\.mjs$/.test(base)
      ? [base.replace(/\.mjs$/, '.mts')]
      : /\.cjs$/.test(base)
        ? [base.replace(/\.cjs$/, '.cts')]
        : /\.js$/.test(base)
          ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]
          : []),
    base,
    ...[
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
      '.js',
      '.mjs',
      '.cjs',
      '.json',
      '/index.ts',
      '/index.js',
      '/action.yml',
      '/action.yaml',
    ].map((ext) => base + ext),
  ].find((path) => paths.has(path));
}
interface Alias {
  pattern: string;
  targets: string[];
  origin: string;
}
interface Config {
  path: string;
  aliases: Alias[];
  base?: string;
  pathsDefined?: boolean;
  baseDefined?: boolean;
}
export function createModuleResolver(files: readonly RepositoryFile[], paths: ReadonlySet<string>) {
  const source = new Map(
    files
      .filter((file) => /(?:^|\/)tsconfig(?:\.[^/]*)?\.json$/i.test(file.path))
      .map((file) => [file.path, file.content]),
  );
  // extends先はtsconfigという名前に限定しない。
  const all = new Map(files.map((file) => [file.path, file.content]));
  const cache = new Map<string, Config>(),
    warnings = new Set<string>();
  const read = (path: string, chain: string[]): Config => {
    if (cache.has(path)) return cache.get(path)!;
    if (chain.includes(path)) {
      warnings.add(`${path}: tsconfig extendsが循環しています。`);
      return { path, aliases: [] };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseJSONC(all.get(path) ?? '');
    } catch {
      warnings.add(`${path}: tsconfigを解析できません。`);
      return { path, aliases: [] };
    }
    const merged: Config = { path, aliases: [] };
    const parents = Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends];
    for (const parent of parents)
      if (typeof parent === 'string') {
        if (!parent.startsWith('.')) {
          warnings.add(`${path}: 外部パッケージのextendsは未対応です。`);
          continue;
        }
        const base = normalizePath(path, parent),
          resolved = base && findModule(base, paths);
        if (!resolved || !all.has(resolved)) {
          warnings.add(`${path}: extends先が未取得です。`);
          continue;
        }
        const inherited = read(resolved, [...chain, path]);
        if (inherited.pathsDefined) {
          merged.aliases = inherited.aliases;
          merged.pathsDefined = true;
        }
        if (inherited.baseDefined) {
          merged.base = inherited.base;
          merged.baseDefined = true;
        }
      }
    const options = parsed.compilerOptions as Record<string, unknown> | undefined;
    if (typeof options?.baseUrl === 'string') {
      const base = normalizePath(path, options.baseUrl);
      if (base === undefined) {
        warnings.add(`${path}: baseUrlが取得範囲外です。`);
        return { path, aliases: [] };
      }
      merged.base = base;
      merged.baseDefined = true;
    }
    if (options?.paths && typeof options.paths === 'object' && !Array.isArray(options.paths))
      merged.aliases = Object.entries(options.paths).flatMap(([pattern, targets]) =>
        Array.isArray(targets) &&
        targets.every((value) => typeof value === 'string') &&
        pattern.split('*').length <= 2
          ? [{ pattern, targets, origin: path }]
          : [],
      );
    if (options?.paths && typeof options.paths === 'object' && !Array.isArray(options.paths))
      merged.pathsDefined = true;
    cache.set(path, merged);
    return merged;
  };
  const configs = [...source.keys()].map((path) => read(path, []));
  const configFor = (from: string) =>
    configs
      .filter((config) => {
        const dir = config.path.split('/').slice(0, -1).join('/');
        return !dir || from.startsWith(dir + '/');
      })
      .sort(
        (a, b) =>
          b.path.split('/').length - a.path.split('/').length ||
          Number(!a.path.endsWith('/tsconfig.json') && a.path !== 'tsconfig.json') -
            Number(!b.path.endsWith('/tsconfig.json') && b.path !== 'tsconfig.json'),
      )[0];
  const matches = (pattern: string, target: string): string | undefined => {
    if (!pattern.includes('*')) return pattern === target ? '' : undefined;
    const [start, end] = pattern.split('*');
    return target.startsWith(start) &&
      target.endsWith(end) &&
      target.length >= start.length + end.length
      ? target.slice(start.length, target.length - end.length)
      : undefined;
  };
  return {
    warnings: [...warnings],
    resolve(from: string, target: string): string | undefined {
      if (target.startsWith('.')) {
        const base = normalizePath(from, target);
        return base && findModule(base, paths);
      }
      const config = configFor(from);
      if (!config) return;
      const aliases = config.aliases
        .filter((alias) => matches(alias.pattern, target) !== undefined)
        .sort(
          (a, b) =>
            Number(b.pattern === target) - Number(a.pattern === target) ||
            b.pattern.split('*')[0].length - a.pattern.split('*')[0].length,
        );
      const alias = aliases[0];
      if (alias) {
        const match = matches(alias.pattern, target)!;
        for (const candidate of alias.targets) {
          const reference = candidate.replace('*', match);
          const origin =
            config.base !== undefined
              ? (config.base ? config.base + '/' : '') + '__base__.json'
              : alias.origin;
          const base = normalizePath(origin, reference),
            resolved = base && findModule(base, paths);
          if (resolved) return resolved;
        }
        return;
      }
      if (config.base !== undefined) {
        const base = normalizePath(
          (config.base ? config.base + '/' : '') + '__base__.json',
          target,
        );
        return base && findModule(base, paths);
      }
    },
    isAlias(from: string, target: string): boolean {
      return !!configFor(from)?.aliases.some(
        (alias) => matches(alias.pattern, target) !== undefined,
      );
    },
  };
}

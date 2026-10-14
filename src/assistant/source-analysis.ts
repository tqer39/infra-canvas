import { parse as parseTOML } from 'smol-toml';
import ts from 'typescript';
import { parseDocument } from 'yaml';
import { parseJSONC } from './jsonc.js';
import type { RepositoryFile } from './contract.js';
export interface SourceReference {
  kind: 'import' | 'script' | 'entry' | 'action' | 'config' | 'type';
  target: string;
  line: number;
  symbol?: string;
  imported?: string;
}
export interface SourceCall {
  symbol: string;
  owner: string;
  line: number;
  literals: string[];
  environment: string[];
  commandArguments: boolean;
}
export interface SourceInfo {
  references: SourceReference[];
  calls: SourceCall[];
  warnings: string[];
  literals: string[];
  config?: Record<string, unknown>;
}
export function resolveLocal(
  from: string,
  target: string,
  paths: ReadonlySet<string>,
): string | undefined {
  if (!target || target.includes('\\') || target.startsWith('/') || target.includes('\0')) return;
  const parts = target.startsWith('.') ? from.split('/').slice(0, -1) : [];
  for (const part of target.split('/')) {
    if (part === '..') {
      if (!parts.length) return;
      parts.pop();
    } else if (part !== '.' && part) parts.push(part);
  }
  const base = parts.join('/');
  return [
    base,
    ...[
      '.ts',
      '.tsx',
      '.js',
      '.mjs',
      '.cjs',
      '.mts',
      '.cts',
      '/index.ts',
      '/index.js',
      '/action.yml',
      '/action.yaml',
    ].map((ext) => base + ext),
    base.replace(/\.js$/, '.ts'),
  ].find((path) => paths.has(path));
}
export function parseConfig(file: RepositoryFile): Record<string, unknown> {
  if (/\.toml$/i.test(file.path)) return parseTOML(file.content, { unsafeKeyBehaviour: 'throw' });
  if (/\.ya?ml$/i.test(file.path)) {
    const doc = parseDocument(file.content, { uniqueKeys: true });
    if (doc.errors.length) throw Error('YAML構文エラー');
    const value = doc.toJS({ maxAliasCount: 30 });
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('設定はオブジェクトです');
    return value;
  }
  return parseJSONC(file.content);
}
function shellScripts(command: string): string[] {
  // シェルは実行しない。リテラルのNode呼び出しだけを入口にする。
  return [
    ...command.matchAll(
      /(?:^|[\n;&|])[ \t]*(?:node|tsx|ts-node)[ \t]+(?:["']([^"']+)["']|([\w./-]+))/g,
    ),
  ].map((match) => match[1] ?? match[2]);
}
export function inspectSource(file: RepositoryFile): SourceInfo {
  const result: SourceInfo = { references: [], calls: [], warnings: [], literals: [] };
  if (/\.(?:jsonc?|ya?ml|toml)$/i.test(file.path)) {
    try {
      const config = parseConfig(file);
      result.config = config;
      if (/(?:^|\/)tsconfig(?:\.[^/]*)?\.json$/i.test(file.path))
        for (const parent of Array.isArray(config.extends) ? config.extends : [config.extends])
          if (typeof parent === 'string')
            result.references.push({ kind: 'config', target: parent, line: 1 });
      if (typeof config.main === 'string')
        result.references.push({
          kind: 'entry',
          target: './' + config.main.replace(/^\.\//, ''),
          line: 1,
        });
      for (const entry of ['module', 'types'])
        if (typeof config[entry] === 'string')
          result.references.push({ kind: 'entry', target: './' + String(config[entry]), line: 1 });
      if (config.scripts && typeof config.scripts === 'object')
        for (const command of Object.values(config.scripts))
          if (typeof command === 'string')
            for (const target of shellScripts(command))
              result.references.push({
                kind: 'script',
                target: './' + target.replace(/^\.\//, ''),
                line: 1,
              });
      const seen = new WeakSet<object>();
      const visit = (value: unknown, directory = ''): void => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
          value.forEach((item) => visit(item, directory));
          return;
        }
        const record = value as Record<string, unknown>;
        const defaults = (record.defaults as { run?: Record<string, unknown> } | undefined)?.run;
        const dir =
          typeof record['working-directory'] === 'string'
            ? record['working-directory']
            : typeof defaults?.['working-directory'] === 'string'
              ? defaults['working-directory']
              : directory;
        if (typeof record.run === 'string')
          for (const target of shellScripts(record.run))
            result.references.push({
              kind: 'script',
              target: (dir ? dir + '/' : '') + target.replace(/^\.\//, ''),
              line: 1,
            });
        if (typeof record.uses === 'string' && record.uses.startsWith('./'))
          result.references.push({ kind: 'action', target: record.uses.slice(2), line: 1 });
        Object.values(record).forEach((item) => visit(item, dir));
      };
      visit(config);
    } catch {
      result.warnings.push(`${file.path}: 設定の構文を解析できませんでした。`);
    }
    return result;
  }

  if (!/\.[cm]?[jt]sx?$/i.test(file.path)) return result;
  const ast = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const diagnostics = (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (diagnostics.length) {
    result.warnings.push(`${file.path}: 構文エラーがあり呼び出しを解析しません。`);
    return result;
  }
  const declarations = new Map<string, ts.Expression>();
  const ambiguous = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (declarations.has(node.name.text)) ambiguous.add(node.name.text);
      declarations.set(node.name.text, node.initializer);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (declarations.has(node.name.text)) ambiguous.add(node.name.text);
      declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(ast);
  const constantString = (
    node: ts.Node,
    seen = new Set<string>(),
    depth = 0,
  ): string | undefined => {
    if (depth > 8) return;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return constantString(node.expression, seen, depth + 1);
    if (ts.isIdentifier(node)) {
      if (ambiguous.has(node.text)) return;
      if (seen.has(node.text)) return;
      const value = declarations.get(node.text);
      return value && constantString(value, new Set([...seen, node.text]), depth + 1);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = constantString(node.left, seen, depth + 1),
        b = constantString(node.right, seen, depth + 1);
      return a !== undefined && b !== undefined ? a + b : undefined;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = constantString(span.expression, seen, depth + 1);
        if (part === undefined) return;
        value += part + span.literal.text;
      }
      return value;
    }
  };
  const strings = (node: ts.Node, seen = new Set<string>(), depth = 0): string[] => {
    if (depth > 8) return [];
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isCallExpression(node) && node.expression.getText(ast) !== 'fileURLToPath') return [];
    if (ts.isIdentifier(node)) {
      if (ambiguous.has(node.text)) return [];
      if (seen.has(node.text)) return [];
      const value = declarations.get(node.text);
      if (!value) return [];
      return strings(value, new Set([...seen, node.text]), depth + 1);
    }
    const values: string[] = [];
    ts.forEachChild(node, (child) => {
      values.push(...strings(child, seen, depth + 1));
    });
    return values;
  };
  const environments = (node: ts.Node): string[] => {
    const values = new Set<string>();
    const visit = (item: ts.Node): void => {
      if (ts.isPropertyAccessExpression(item) && /(?:^|\.)env$/.test(item.expression.getText(ast)))
        values.add(item.name.text);
      ts.forEachChild(item, visit);
    };
    visit(node);
    return [...values];
  };
  const line = (node: ts.Node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  const visit = (node: ts.Node, owner: string): void => {
    if (ts.isFunctionDeclaration(node) && node.name) owner = node.name.text;
    if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node))
      owner = ts.isConstructorDeclaration(node) ? 'constructor' : node.name.getText(ast);
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isVariableDeclaration(node.parent)
    )
      owner = node.parent.name.getText(ast);
    if (ts.isStringLiteralLike(node)) result.literals.push(node.text);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = node.moduleSpecifier.text,
        clause = node.importClause;
      const kind = clause?.isTypeOnly ? ('type' as const) : ('import' as const);
      if (clause?.name)
        result.references.push({
          kind,
          target,
          line: line(node),
          symbol: clause.name.text,
          imported: 'default',
        });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const binding of clause.namedBindings.elements)
          result.references.push({
            kind: binding.isTypeOnly ? 'type' : kind,
            target,
            line: line(node),
            symbol: binding.name.text,
            imported: binding.propertyName?.text ?? binding.name.text,
          });
      else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        result.references.push({
          kind,
          target,
          line: line(node),
          symbol: clause.namedBindings.name.text,
          imported: '*',
        });
      if (!clause) result.references.push({ kind, target, line: line(node) });
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.references.push({
        kind: node.isTypeOnly ? 'type' : 'import',
        target: node.moduleSpecifier.text,
        line: line(node),
      });
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const args = node.arguments ?? [];
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(ast) === 'require')
      ) {
        const target = args[0] && constantString(args[0]);
        if (target !== undefined)
          result.references.push({ kind: 'import', target, line: line(node) });
        else
          result.warnings.push(
            `${file.path}:${line(node)}: 動的import/requireの値は構文解析だけでは未確定です。`,
          );
      }
      result.calls.push({
        symbol: /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(node.expression.getText(ast))
          ? node.expression.getText(ast)
          : '<dynamic>',
        owner,
        line: line(node),
        commandArguments: args.some(
          (arg) =>
            ts.isArrayLiteralExpression(arg) ||
            (ts.isIdentifier(arg) &&
              ts.isArrayLiteralExpression(declarations.get(arg.text) ?? ast)),
        ),
        literals: args.flatMap((arg) => strings(arg)).slice(0, 80),
        environment: args.flatMap((arg) => environments(arg)),
      });
    }
    ts.forEachChild(node, (child) => visit(child, owner));
  };
  visit(ast, '<module>');
  return result;
}

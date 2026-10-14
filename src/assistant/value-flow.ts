import ts from 'typescript';
import type { RepositoryFile } from './contract.js';
import type { SourceCall, SourceReference } from './source-analysis.js';
import { createModuleResolver } from './module-resolution.js';
const unknown = Symbol('unknown');
const noReturn = Symbol('noReturn');
type V = string | number | boolean | null | typeof unknown | V[] | Obj | Fn | External | Mod;
interface Obj {
  tag: 'object';
  props: Map<string, V>;
}
interface Fn {
  tag: 'function';
  node: ts.FunctionLikeDeclaration;
  file: string;
  scope: Scope;
  name: string;
  prefix?: V[];
  target?: V;
  boundThis?: V;
}
interface External {
  tag: 'external';
  name: string;
}
interface Mod {
  tag: 'module';
  file: string;
}
interface Binding {
  node?: ts.Expression;
  value?: V;
  busy?: boolean;
  uninitialized?: boolean;
}
interface Scope {
  parent?: Scope;
  bindings: Map<string, Binding>;
  file: string;
  owner: string;
}
export interface ValueFlow {
  from: { file: string; line: number };
  to: { file: string; line: number };
  arguments: number;
  resolved: number;
}
export interface FlowResult {
  calls: {
    file: string;
    call: SourceCall;
    trace: { file: string; line: number; reason: string }[];
  }[];
  references: { file: string; reference: SourceReference }[];
  flows: ValueFlow[];
  warnings: string[];
}
const object = (props = new Map<string, V>()): Obj => ({ tag: 'object', props });
const tagged = <T extends Obj | Fn | External | Mod>(value: V, tag: T['tag']): value is T =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  'tag' in value &&
  value.tag === tag;
function known(value: V, depth = 0): boolean {
  if (depth > 6 || value === unknown || tagged<External>(value, 'external')) return false;
  if (Array.isArray(value)) return value.every((item) => known(item, depth + 1));
  if (tagged<Obj>(value, 'object'))
    return [...value.props.values()].every((item) => known(item, depth + 1));
  return true;
}
/** AST上の値伝播のみ。ユーザーコード・外部API・evalを実行しない。 */
export function traceValueFlow(
  files: readonly RepositoryFile[],
  root: string,
  paths = new Set(files.map((file) => file.path)),
): FlowResult {
  const resolver = createModuleResolver(files, paths),
    source = new Map(files.map((file) => [file.path, file]));
  const modules = new Map<
    string,
    {
      ast: ts.SourceFile;
      scope: Scope;
      exports: Map<string, { binding?: string; value?: V }>;
      initialized: boolean;
    }
  >();
  const result: FlowResult = { calls: [], references: [], flows: [], warnings: [] };
  let steps = 0,
    invocations = 0;
  const stack: { file: string; line: number; reason: string }[] = [];
  const warn = (file: string, line: number, message: string) => {
    if (result.warnings.length < 60) result.warnings.push(`${file}:${line}: ${message}`);
  };
  const line = (node: ts.Node) =>
    node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const flatten = (value: V, depth = 0): string[] =>
    depth > 6
      ? []
      : typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.flatMap((item) => flatten(item, depth + 1))
          : tagged<Obj>(value, 'object')
            ? [...value.props.values()].flatMap((item) => flatten(item, depth + 1))
            : [];
  const fn = (node: ts.FunctionLikeDeclaration, scope: Scope, name: string): Fn => ({
    tag: 'function',
    node,
    file: scope.file,
    scope,
    name,
  });
  const locate = (scope: Scope, name: string): { scope: Scope; binding: Binding } | undefined =>
    scope.bindings.has(name)
      ? { scope, binding: scope.bindings.get(name)! }
      : scope.parent
        ? locate(scope.parent, name)
        : undefined;
  const get = (scope: Scope, name: string): V => {
    const found = locate(scope, name);
    if (!found) return { tag: 'external', name };
    const binding = found.binding;
    if (binding.uninitialized) {
      warn(
        found.scope.file,
        binding.node ? line(binding.node) : 1,
        '初期化前の変数は未確定として扱います。',
      );
      return unknown;
    }
    if (binding.value !== undefined) return binding.value;
    if (!binding.node || binding.busy) return unknown;
    binding.busy = true;
    binding.value = expression(binding.node, found.scope);
    binding.busy = false;
    return binding.value;
  };
  const exportValue = (file: string, name: string): V => {
    const module = prepare(file);
    if (!module) return unknown;
    initialize(file);
    const value = module.exports.get(name);
    return value?.binding ? get(module.scope, value.binding) : (value?.value ?? unknown);
  };
  const property = (value: V, key: string): V => {
    if (tagged<Obj>(value, 'object')) return value.props.get(key) ?? unknown;
    if (tagged<Mod>(value, 'module')) return exportValue(value.file, key);
    if (tagged<External>(value, 'external'))
      return { tag: 'external', name: value.name + '.' + key };
    if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)] ?? unknown;
    if (Array.isArray(value) && key === 'length') return value.length;
    return unknown;
  };
  const bindName = (name: ts.BindingName, value: V, scope: Scope): void => {
    if (ts.isIdentifier(name)) {
      scope.bindings.set(name.text, { value });
      return;
    }
    for (const [index, element] of name.elements.entries())
      if (ts.isBindingElement(element)) {
        const key = ts.isArrayBindingPattern(name)
          ? String(index)
          : (element.propertyName?.getText().replace(/^['"]|['"]$/g, '') ?? element.name.getText());
        const selected = property(value, key);
        bindName(
          element.name,
          selected === unknown && element.initializer
            ? expression(element.initializer, scope)
            : selected,
          scope,
        );
      }
  };
  const prepare = (file: string) => {
    if (modules.has(file)) return modules.get(file);
    const text = source.get(file);
    if (!text || !/\.[cm]?[jt]sx?$/.test(file)) return;
    const ast = ts.createSourceFile(file, text.content, ts.ScriptTarget.Latest, true);
    if (
      (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
        .length
    )
      return;
    const scope: Scope = { file, owner: '<module>', bindings: new Map() };
    const module = {
      ast,
      scope,
      exports: new Map<string, { binding?: string; value?: V }>(),
      initialized: false,
    };
    modules.set(file, module);
    for (const node of ast.statements) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        scope.bindings.set(node.name.text, { value: fn(node, scope, node.name.text) });
        if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword))
          module.exports.set(
            node.modifiers.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword)
              ? 'default'
              : node.name.text,
            { binding: node.name.text },
          );
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        !node.importClause?.isTypeOnly
      ) {
        const target = resolver.resolve(file, node.moduleSpecifier.text);
        const mod: V = target
          ? { tag: 'module', file: target }
          : { tag: 'external', name: node.moduleSpecifier.text };
        const clause = node.importClause;
        if (clause?.name)
          scope.bindings.set(clause.name.text, {
            value: target
              ? exportProxy(target, 'default')
              : { tag: 'external', name: node.moduleSpecifier.text + '.default' },
          });
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
          scope.bindings.set(clause.namedBindings.name.text, { value: mod });
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const item of clause.namedBindings.elements)
            scope.bindings.set(item.name.text, {
              value: target
                ? exportProxy(target, item.propertyName?.text ?? item.name.text)
                : {
                    tag: 'external',
                    name:
                      node.moduleSpecifier.text + '.' + (item.propertyName?.text ?? item.name.text),
                  },
            });
      }
      if (
        ts.isFunctionDeclaration(node) &&
        !node.name &&
        node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword)
      )
        module.exports.set('default', { value: fn(node, scope, '<default>') });
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const target = resolver.resolve(file, node.moduleSpecifier.text);
        if (target && node.exportClause && ts.isNamedExports(node.exportClause))
          for (const item of node.exportClause.elements)
            module.exports.set(item.name.text, {
              value: exportProxy(target, item.propertyName?.text ?? item.name.text),
            });
        else if (target && !node.exportClause) {
          const parent = prepare(target);
          for (const key of parent?.exports.keys() ?? [])
            if (key !== 'default') module.exports.set(key, { value: exportProxy(target, key) });
        }
      }
      if (ts.isVariableStatement(node))
        for (const declaration of node.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            scope.bindings.set(declaration.name.text, {
              node: declaration.initializer,
              uninitialized: true,
            });
            if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword))
              module.exports.set(declaration.name.text, { binding: declaration.name.text });
          }
    }
    return module;
  };
  // 外部名と区別した遅延export参照。循環importでも初期化が完了するまで待つ。
  const exportProxy = (file: string, name: string): External => ({
    tag: 'external',
    name: '@local:' + file + '#' + name,
  });
  const dereference = (input: V): V => {
    let value = input;
    const seen = new Set<string>();
    for (let depth = 0; depth < 12; depth++) {
      if (!tagged<External>(value, 'external') || !value.name.startsWith('@local:')) return value;
      if (seen.has(value.name)) return unknown;
      seen.add(value.name);
      const [file, name] = value.name.slice(7).split('#');
      value = exportValue(file, name);
    }
    return unknown;
  };
  const initialize = (file: string): void => {
    const module = prepare(file);
    if (!module || module.initialized) return;
    module.initialized = true;
    for (const node of module.ast.statements) if (statement(node, module.scope) !== noReturn) break;
  };
  const call = (target: V, args: V[], at: ts.Node, scope: Scope, receiver: V = unknown): V => {
    target = dereference(target);
    if (tagged<Mod>(target, 'module')) target = exportValue(target.file, 'default');
    if (++invocations > 512 || stack.length > 12) {
      warn(scope.file, line(at), '呼び出し追跡の上限に達しました。');
      return unknown;
    }
    if (tagged<Fn>(target, 'function')) {
      if (target.target)
        return call(
          target.target,
          [...(target.prefix ?? []), ...args],
          at,
          scope,
          target.boundThis ?? receiver,
        );
      const child: Scope = {
        file: target.file,
        owner: target.name,
        parent: target.scope,
        bindings: new Map(),
      };
      child.bindings.set('this', {
        value: ts.isArrowFunction(target.node) ? get(target.scope, 'this') : receiver,
      });
      target.node.parameters.forEach((param, index) =>
        bindName(
          param.name,
          param.dotDotDotToken
            ? args.slice(index)
            : (args[index] ?? (param.initializer ? expression(param.initializer, child) : unknown)),
          child,
        ),
      );
      result.flows.push({
        from: { file: scope.file, line: line(at) },
        to: { file: target.file, line: line(target.node) },
        arguments: args.length,
        resolved: args.filter((value) => known(value)).length,
      });
      stack.push({ file: scope.file, line: line(at), reason: '関数引数を受け渡して呼び出し' });
      const value = target.node.body
        ? ts.isBlock(target.node.body)
          ? block(target.node.body, child)
          : expression(target.node.body, child)
        : unknown;
      stack.pop();
      return value === noReturn ? unknown : value;
    }
    const symbol = tagged<External>(target, 'external') ? target.name : '<unresolved>';
    if (symbol === 'fileURLToPath' || symbol === 'node:url.fileURLToPath')
      return tagged<Obj>(args[0], 'object')
        ? (args[0].props.get('pathname') ?? unknown)
        : (args[0] ?? unknown);
    if (symbol === 'URL') return object(new Map([['pathname', args[0] ?? unknown]]));
    if (symbol === 'Object.fromEntries' && Array.isArray(args[0])) {
      const props = new Map<string, V>();
      for (const pair of args[0])
        if (Array.isArray(pair) && typeof pair[0] === 'string')
          props.set(pair[0], pair[1] ?? unknown);
      return object(props);
    }
    if (symbol === 'eval' || symbol === 'Function') {
      warn(scope.file, line(at), 'eval/Functionの内容は解析しません。');
      return unknown;
    }
    if (symbol === '<unresolved>') warn(scope.file, line(at), '呼び出し先を静的に解決できません。');
    result.calls.push({
      file: scope.file,
      call: {
        symbol: /^[\w$.:/-]+$/.test(symbol) ? symbol : '<dynamic>',
        owner: scope.owner,
        line: line(at),
        literals: args.flatMap((arg) => flatten(arg)).slice(0, 80),
        commandArguments: args.some(Array.isArray),
        environment: [],
      },
      trace: [...stack],
    });
    return unknown;
  };
  const expression = (node: ts.Expression, scope: Scope): V => {
    if (++steps > 25000) {
      warn(scope.file, line(node), '値追跡の上限に達しました。');
      return unknown;
    }
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (node.kind === ts.SyntaxKind.ThisKeyword) return get(scope, 'this');
    if (ts.isIdentifier(node)) return dereference(get(scope, node.text));
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAwaitExpression(node)
    )
      return expression(node.expression, scope);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      return fn(
        node,
        scope,
        ts.isVariableDeclaration(node.parent) ? node.parent.name.getText() : '<callback>',
      );
    if (ts.isArrayLiteralExpression(node)) {
      const items: V[] = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) {
          const value = expression(element.expression, scope);
          if (Array.isArray(value)) items.push(...value.slice(0, 32));
          else return unknown;
        } else if (ts.isExpression(element)) items.push(expression(element, scope));
      }
      return items;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, V>();
      for (const item of node.properties) {
        if (ts.isSpreadAssignment(item)) {
          const value = expression(item.expression, scope);
          if (tagged<Obj>(value, 'object'))
            for (const [key, val] of value.props) props.set(key, val);
          else return unknown;
          continue;
        }
        if (
          ts.isPropertyAssignment(item) ||
          ts.isMethodDeclaration(item) ||
          ts.isShorthandPropertyAssignment(item)
        ) {
          const key = ts.isComputedPropertyName(item.name)
            ? expression(item.name.expression, scope)
            : item.name.getText().replace(/^['"]|['"]$/g, '');
          if (typeof key !== 'string') return unknown;
          props.set(
            key,
            ts.isPropertyAssignment(item)
              ? expression(item.initializer, scope)
              : ts.isMethodDeclaration(item)
                ? fn(item, scope, key)
                : get(scope, item.name.text),
          );
        }
      }
      return object(props);
    }
    if (ts.isPropertyAccessExpression(node))
      return dereference(property(expression(node.expression, scope), node.name.text));
    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression && expression(node.argumentExpression, scope);
      return typeof key === 'string' || typeof key === 'number'
        ? dereference(property(expression(node.expression, scope), String(key)))
        : unknown;
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const value = expression(span.expression, scope);
        if (!['string', 'number', 'boolean'].includes(typeof value)) return unknown;
        text += String(value) + span.literal.text;
      }
      return text;
    }
    if (ts.isBinaryExpression(node)) {
      const left = expression(node.left, scope),
        right = expression(node.right, scope);
      if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        ['string', 'number'].includes(typeof left) &&
        ['string', 'number'].includes(typeof right)
      )
        return typeof left === 'string' || typeof right === 'string'
          ? String(left) + String(right)
          : Number(left) + Number(right);
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const found = locate(scope, node.left.text);
        if (found) found.binding.value = right;
        return right;
      }
      if (
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left)
      ) {
        const base = node.left.expression.getText(),
          key = node.left.name.text;
        const module = modules.get(scope.file);
        if (base === 'module' && key === 'exports') {
          module?.exports.set('default', { value: right });
          if (tagged<Obj>(right, 'object'))
            for (const [name, value] of right.props) module?.exports.set(name, { value });
          return right;
        }
        if (base === 'exports' || base === 'module.exports') {
          module?.exports.set(key, { value: right });
          return right;
        }
      }
      if (
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        left !== unknown &&
        right !== unknown
      )
        return left === right;
      return unknown;
    }
    if (ts.isConditionalExpression(node)) {
      const condition = expression(node.condition, scope);
      if (typeof condition === 'boolean')
        return expression(condition ? node.whenTrue : node.whenFalse, scope);
      warn(scope.file, line(node), '条件が未確定のため値を確定しません。');
      return unknown;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const args: V[] = [];
      for (const arg of node.arguments ?? []) {
        if (ts.isSpreadElement(arg)) {
          const value = expression(arg.expression, scope);
          if (Array.isArray(value)) args.push(...value);
          else args.push(unknown);
        } else args.push(expression(arg, scope));
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText() === 'require')
      ) {
        if (typeof args[0] !== 'string') {
          warn(scope.file, line(node), '動的import/requireの値が未確定です。');
          return unknown;
        }
        result.references.push({
          file: scope.file,
          reference: { kind: 'import', target: args[0], line: line(node) },
        });
        const path = resolver.resolve(scope.file, args[0]);
        if (path) {
          initialize(path);
          return { tag: 'module', file: path };
        }
        return { tag: 'external', name: args[0] };
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const base = expression(node.expression.expression, scope),
          member = node.expression.name.text;
        if (
          ['bind', 'call', 'apply'].includes(member) &&
          (tagged<Fn>(base, 'function') || tagged<External>(base, 'external'))
        ) {
          if (member === 'bind')
            return {
              tag: 'function',
              node: node as unknown as ts.FunctionLikeDeclaration,
              file: scope.file,
              scope,
              name: '<bound>',
              target: base,
              prefix: args.slice(1),
              boundThis: args[0] ?? unknown,
            };
          return call(
            base,
            member === 'apply' && Array.isArray(args[1]) ? args[1] : args.slice(1),
            node,
            scope,
            args[0] ?? unknown,
          );
        }
        if (tagged<Obj>(base, 'object') || tagged<Mod>(base, 'module'))
          return call(property(base, member), args, node, scope, base);
        if (member === 'map' && Array.isArray(base) && args[0])
          return base
            .slice(0, 16)
            .map((value, index) => call(args[0], [value, index], node, scope));
      }
      if (ts.isElementAccessExpression(node.expression))
        return call(
          expression(node.expression, scope),
          args,
          node,
          scope,
          expression(node.expression.expression, scope),
        );
      return call(expression(node.expression, scope), args, node, scope);
    }
    return unknown;
  };
  const block = (node: ts.Block, scope: Scope): V | typeof noReturn => {
    for (const item of node.statements)
      if (ts.isFunctionDeclaration(item) && item.name)
        scope.bindings.set(item.name.text, { value: fn(item, scope, item.name.text) });
    for (const item of node.statements) {
      const completion = statement(item, scope);
      if (completion !== noReturn) return completion;
    }
    return noReturn;
  };
  const statement = (node: ts.Statement, scope: Scope): V | typeof noReturn => {
    if (++steps > 25000) return unknown;
    if (ts.isThrowStatement(node)) {
      warn(scope.file, line(node), 'throw以降の値伝播を打ち切ります。');
      return unknown;
    }
    if (ts.isReturnStatement(node))
      return node.expression ? expression(node.expression, scope) : unknown;
    if (ts.isFunctionDeclaration(node) && node.name)
      scope.bindings.set(node.name.text, { value: fn(node, scope, node.name.text) });
    else if (ts.isVariableStatement(node))
      for (const declaration of node.declarationList.declarations)
        bindName(
          declaration.name,
          declaration.initializer ? expression(declaration.initializer, scope) : unknown,
          scope,
        );
    else if (ts.isExpressionStatement(node)) expression(node.expression, scope);
    else if (ts.isBlock(node)) return block(node, { ...scope, parent: scope, bindings: new Map() });
    else if (ts.isIfStatement(node)) {
      const condition = expression(node.expression, scope);
      if (typeof condition === 'boolean') {
        if (condition) return statement(node.thenStatement, scope);
        if (node.elseStatement) return statement(node.elseStatement, scope);
      } else {
        warn(scope.file, line(node), '実行条件が未確定のため、この先の値伝播を打ち切ります。');
        return unknown;
      }
    } else if (ts.isExportAssignment(node))
      modules
        .get(scope.file)
        ?.exports.set('default', { value: expression(node.expression, scope) });
    else if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      warn(scope.file, line(node), 'ループの値伝播は未対応です。');
      return unknown;
    }
    return noReturn;
  };
  initialize(root);
  result.warnings = [...new Set(result.warnings)];
  return result;
}

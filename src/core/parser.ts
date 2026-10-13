import { resourceContent } from './content.js';
import { boundaryTypes } from './model.js';
import type {
  Attribute,
  Attributes,
  Connection,
  Diagnostic,
  Diagram,
  EdgeKind,
  ParseResult,
  Resource,
  SourceLocation,
  View,
} from './model.js';

interface Token extends SourceLocation {
  value: string;
  kind: 'word' | 'string' | 'symbol' | 'newline' | 'eof';
}
const edgeKinds = new Set(['traffic', 'dependency', 'auth', 'deploy', 'association']);
const textAttributes = new Set([
  'display',
  'description',
  'region',
  'az',
  'azId',
  'availability_zone_id',
  'cidr',
  'protocol',
  'account',
  'project',
  'subscription',
  'status',
  'scope',
  'address',
  'repository',
  'commit',
  'root',
  'file',
  'provenance',
  'sourceKind',
  'network',
  'routeEvidence',
  'provider',
  'environment',
  'role',
  'url',
  'version',
  'subnetType',
  'terraformType',
  'availability_zone',
  'cidr_block',
  'instance_type',
  'engine',
  'engine_version',
  'placement',
  'subnetVisibility',
]);
const arrayAttributes = new Set([
  'columns',
  'rows',
  'items',
  'subnets',
  'members',
  'tags',
  'securityGroups',
  'unresolved',
  'dependsOn',
]);
const numberAttributes = new Set(['port', 'width', 'height', 'x', 'y', 'line']);
const boolAttributes = new Set(['public', 'unknown', 'fixed']);
class ParseFailure extends Error {}

export function parseDSL(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const tokens: Token[] = [];
  let offset = 0,
    line = 1,
    column = 1;
  const advance = (): string => {
    const c = source[offset++]!;
    if (c === '\n') {
      line++;
      column = 1;
    } else column++;
    return c;
  };
  const report = (token: SourceLocation, code: string, message: string): void => {
    diagnostics.push({ ...token, code, message, severity: 'error' });
  };
  while (offset < source.length) {
    const c = source[offset]!;
    if (c === ' ' || c === '\t' || c === '\r') {
      advance();
      continue;
    }
    if (c === '#' || source.slice(offset, offset + 2) === '//') {
      while (offset < source.length && source[offset] !== '\n') advance();
      continue;
    }
    const start = { line, column };
    if (c === '\n' || c === ';') {
      advance();
      tokens.push({ ...start, value: '\n', kind: 'newline' });
      continue;
    }
    if (c === '"') {
      const begin = offset;
      advance();
      let terminated = false;
      while (offset < source.length) {
        const next = advance();
        if (next === '\\') {
          if (offset < source.length) advance();
        } else if (next === '"') {
          terminated = true;
          break;
        } else if (next === '\n') break;
      }
      if (!terminated) {
        report(start, 'syntax.string', '文字列を同じ行の二重引用符で閉じてください。');
        break;
      }
      try {
        tokens.push({
          ...start,
          value: JSON.parse(source.slice(begin, offset)) as string,
          kind: 'string',
        });
      } catch {
        report(start, 'syntax.escape', '文字列のエスケープは JSON の規則に従ってください。');
      }
      continue;
    }
    if (source.slice(offset, offset + 2) === '->') {
      advance();
      advance();
      tokens.push({ ...start, value: '->', kind: 'symbol' });
      continue;
    }
    if ('{}[]=,'.includes(c)) {
      advance();
      tokens.push({ ...start, value: c, kind: 'symbol' });
      continue;
    }
    const match = /^[A-Za-z0-9_.:/@+-]+/.exec(source.slice(offset));
    if (match) {
      for (let n = 0; n < match[0].length; n++) advance();
      tokens.push({ ...start, value: match[0], kind: 'word' });
      continue;
    }
    report(start, 'syntax.character', `使用できない文字 ${JSON.stringify(c)} です。`);
    advance();
  }
  tokens.push({ line, column, value: '', kind: 'eof' });
  let cursor = 0;
  const peek = (): Token => tokens[cursor]!;
  const take = (): Token => tokens[cursor++]!;
  const fail = (token: Token, message: string, code = 'syntax.expected'): never => {
    report(token, code, message);
    throw new ParseFailure(message);
  };
  const expect = (value: string): Token => {
    const token = take();
    if (token.value !== value) fail(token, `${value} が必要です。`);
    return token;
  };
  const word = (purpose: string): Token => {
    const token = take();
    if (token.kind !== 'word' || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(token.value))
      fail(token, `${purpose} は英字または _ で始まる ID にしてください。`);
    return token;
  };
  const skipLines = (): void => {
    while (peek().kind === 'newline') take();
  };
  const locations = new Map<string, Token>();
  let valueTokens: Token[] = [];
  const value = (): Attribute => {
    const token = take();
    valueTokens = [token];
    if (token.kind === 'string') return token.value;
    if (token.value === '[') {
      const result: string[] = [];
      skipLines();
      while (peek().value !== ']') {
        const item = take();
        if (item.kind !== 'word' && item.kind !== 'string')
          fail(item, '配列には ID または文字列を指定してください。');
        result.push(item.value);
        valueTokens.push(item);
        skipLines();
        if (peek().value === ']') break;
        expect(',');
        skipLines();
      }
      expect(']');
      return result;
    }
    if (token.kind !== 'word')
      fail(token, '属性値には文字列、数値、boolean、配列を指定してください。');
    if (token.value === 'true' || token.value === 'false') return token.value === 'true';
    if (/^-?(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/.test(token.value)) {
      const n = Number(token.value);
      if (!Number.isFinite(n)) fail(token, '数値は有限値にしてください。');
      return n;
    }
    return token.value;
  };
  const attrs = (): {
    attributes: Attributes;
    positions: Map<string, Token>;
    references: Map<string, Token[]>;
  } => {
    const attributes: Attributes = {},
      positions = new Map<string, Token>(),
      refs = new Map<string, Token[]>();
    while (peek().kind === 'word') {
      const key = word('属性名');
      expect('=');
      if (Object.hasOwn(attributes, key.value))
        report(key, 'attribute.duplicate', `属性 ${key.value} が重複しています。`);
      positions.set(key.value, key);
      attributes[key.value] = value();
      refs.set(key.value, valueTokens.slice(1));
    }
    return { attributes, positions, references: refs };
  };
  const validateAttrs = (
    attributes: Attributes,
    positions: Map<string, Token>,
    context: 'resource' | 'edge' | 'view' | 'diagram',
  ): void => {
    for (const [key, val] of Object.entries(attributes)) {
      const token = positions.get(key)!;
      let valid: boolean, supported: boolean;
      if (context === 'diagram') {
        supported = key === 'version';
        valid = val === 1;
      } else if (context === 'view') {
        supported = ['level', 'overlay', 'direction'].includes(key);
        valid =
          key === 'level'
            ? typeof val === 'string' && ['overview', 'service', 'subnet', 'resource'].includes(val)
            : key === 'direction'
              ? typeof val === 'string' && ['RIGHT', 'DOWN'].includes(val)
              : val === 'sg';
      } else if (context === 'edge') {
        supported = ['kind', 'protocol', 'port', 'label', 'description'].includes(key);
        valid =
          key === 'kind'
            ? typeof val === 'string' && edgeKinds.has(val)
            : key === 'port'
              ? typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 65535
              : typeof val === 'string';
      } else {
        supported =
          textAttributes.has(key) ||
          arrayAttributes.has(key) ||
          numberAttributes.has(key) ||
          boolAttributes.has(key) ||
          key.startsWith('meta.');
        valid =
          key === 'sourceKind'
            ? typeof val === 'string' && ['design', 'plan', 'state', 'static'].includes(val)
            : textAttributes.has(key)
              ? typeof val === 'string'
              : arrayAttributes.has(key)
                ? Array.isArray(val)
                : numberAttributes.has(key)
                  ? typeof val === 'number'
                  : boolAttributes.has(key)
                    ? typeof val === 'boolean'
                    : typeof val === 'string';
      }
      if (!supported)
        report(
          token,
          'attribute.unknown',
          `未知の属性 ${key} です。拡張テキスト属性には meta. 接頭辞を使用してください。`,
        );
      else if (!valid) report(token, 'attribute.type', `属性 ${key} の値または型が不正です。`);
    }
  };
  const resources: Resource[] = [],
    connections: Connection[] = [],
    views: View[] = [];
  const edgeReferences: { id: string; token: Token }[] = [];
  const references: { token: Token; owner: Resource; key: string }[] = [];
  const register = (id: Token): void => {
    if (locations.has(id.value))
      report(
        id,
        'id.duplicate',
        `ID ${id.value} が重複しています。ID は図全体で一意にしてください。`,
      );
    else locations.set(id.value, id);
  };
  let diagram: Diagram | undefined;
  try {
    skipLines();
    expect('diagram');
    const title = take();
    if (title.kind !== 'string') fail(title, 'diagram のタイトルを二重引用符で指定してください。');
    const header = attrs();
    validateAttrs(header.attributes, header.positions, 'diagram');
    expect('{');
    const statements = (parentId?: string): void => {
      skipLines();
      while (peek().kind !== 'eof' && peek().value !== '}') {
        const first = word('リソース種別または接続元');
        if (peek().value === '->') {
          take();
          const target = word('接続先');
          const parsed = attrs();
          validateAttrs(parsed.attributes, parsed.positions, 'edge');
          const kind = (parsed.attributes.kind ?? 'traffic') as EdgeKind;
          delete parsed.attributes.kind;
          edgeReferences.push(
            { id: first.value, token: first },
            { id: target.value, token: target },
          );
          connections.push({
            id: `edge-${connections.length + 1}`,
            source: first.value,
            target: target.value,
            kind,
            attributes: parsed.attributes,
            location: first,
          });
        } else if (first.value === 'view') {
          const id = word('view ID');
          register(id);
          const parsed = attrs();
          validateAttrs(parsed.attributes, parsed.positions, 'view');
          views.push({
            id: id.value,
            level: (parsed.attributes.level ?? 'resource') as View['level'],
            ...(parsed.attributes.overlay ? { overlay: parsed.attributes.overlay as string } : {}),
            ...(parsed.attributes.direction
              ? { direction: parsed.attributes.direction as View['direction'] }
              : {}),
          });
        } else {
          const id = word('リソース ID');
          register(id);
          let label = id.value;
          if (peek().kind === 'string') label = take().value;
          const attributes: Attributes = {};
          if (
            first.value === 'subnet' &&
            ['public', 'private', 'unknown'].includes(peek().value) &&
            tokens[cursor + 1]?.value !== '='
          )
            attributes.subnetType = take().value;
          const parsed = attrs();
          Object.assign(attributes, parsed.attributes);
          validateAttrs(parsed.attributes, parsed.positions, 'resource');
          const resource: Resource = {
            id: id.value,
            type: first.value,
            label,
            ...(parentId ? { parentId } : {}),
            attributes,
            location: first,
            provenance: { kind: 'design' },
          };
          if (['plan', 'state', 'static', 'design'].includes(String(attributes.sourceKind))) {
            resource.provenance = {
              kind: attributes.sourceKind as 'plan' | 'state' | 'static' | 'design',
            };
            for (const key of [
              'repository',
              'commit',
              'root',
              'address',
              'file',
              'line',
            ] as const) {
              const item = attributes[key];
              if (item !== undefined) Object.assign(resource.provenance, { [key]: item });
            }
          }
          if (Array.isArray(attributes.unresolved)) resource.unresolved = attributes.unresolved;
          try {
            resourceContent(resource);
          } catch (error) {
            report(
              parsed.positions.get('display') ?? first,
              'resource.content',
              (error as Error).message,
            );
          }
          resources.push(resource);
          for (const key of ['subnets', 'members', 'securityGroups', 'dependsOn'])
            if (Array.isArray(attributes[key]))
              for (const token of parsed.references.get(key) ?? [])
                references.push({ token, owner: resource, key });
          if (peek().value === '{') {
            if (!boundaryTypes.has(resource.type))
              fail(
                peek(),
                `${resource.type} は入れ子境界ではありません。SG は members 属性で関連付けてください。`,
                'resource.boundary',
              );
            take();
            statements(id.value);
            expect('}');
          }
        }
        if (peek().kind !== 'newline' && peek().value !== '}' && peek().kind !== 'eof')
          fail(peek(), '宣言の後に改行または ; を指定してください。');
        skipLines();
      }
    };
    statements();
    expect('}');
    skipLines();
    if (peek().kind !== 'eof') fail(peek(), 'diagram の後に追加の宣言は置けません。');
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    for (const { id, token } of edgeReferences)
      if (!byId.has(id))
        report(
          token,
          'reference.missing',
          `接続先 ${id} が存在しません。リソースを宣言してください。`,
        );
    for (const ref of references) {
      const target = byId.get(ref.token.value);
      if (!target)
        report(
          ref.token,
          'reference.missing',
          `属性 ${ref.key} の参照 ${ref.token.value} が存在しません。`,
        );
      else if (ref.key === 'subnets' && target.type !== 'subnet')
        report(ref.token, 'reference.type', `${target.id} は subnet ではありません。`);
      else if (ref.key === 'securityGroups' && target.type !== 'sg')
        report(ref.token, 'reference.type', `${target.id} は sg ではありません。`);
    }
    diagram = { version: 1, title: title.value, resources, connections, views, diagnostics };
  } catch (error) {
    if (!(error instanceof ParseFailure)) throw error;
  }
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { diagnostics }
    : { diagram, diagnostics };
}

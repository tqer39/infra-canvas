import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDisplayGraph,
  layoutGraph,
  parseDSL,
  serializeDSL,
  validateDiagram,
} from '../src/core/index.js';
import type { Diagram } from '../src/core/index.js';

const source = `diagram "安全な設計 <script>" version=1 {
  account prod "本番" {
    vpc net {
      subnet a public az="ap-northeast-1a"
      subnet b private az="ap-northeast-1c"
      aws.ecs api "API" subnets=[a, b]
      aws.rds db
      sg one members=[api, db]
      sg two members=[api]
    }
  }
  github.actions ci
  ci -> api kind=deploy
  api -> db kind=traffic protocol=tcp port=5432
  db -> api kind=dependency
  view security level=resource overlay=sg
  view overview level=overview
}`;
const parsed = (): Diagram => {
  const result = parseDSL(source);
  assert.deepEqual(result.diagnostics, []);
  return result.diagram!;
};

describe('DSL', () => {
  it('編集した設計値の DSL に取り込み元の参照を保持する', () => {
    const diagram = parsed();
    diagram.resources[0]!.provenance = {
      kind: 'design',
      repository: 'example/repo',
      address: 'aws_vpc.main',
      file: 'main.tf',
      line: 3,
    };
    const result = parseDSL(serializeDSL(diagram));
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.diagram!.resources[0]!.provenance, diagram.resources[0]!.provenance);
  });
  it('入れ子、複数 subnet、重複 SG を保持する', () => {
    const diagram = parsed();
    assert.equal(diagram.resources.find((resource) => resource.id === 'api')!.parentId, 'net');
    assert.deepEqual(
      diagram.resources.find((resource) => resource.id === 'api')!.attributes.subnets,
      ['a', 'b'],
    );
    assert.equal(diagram.resources.filter((resource) => resource.type === 'sg').length, 2);
  });
  it('属性値を引用して安全に roundtrip する', () => {
    const diagram = parsed();
    diagram.resources[0]!.label = '" }\n<script>alert(1)</script>\\';
    const result = parseDSL(serializeDSL(diagram));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.diagram!.title, diagram.title);
    assert.deepEqual(
      result.diagram!.resources.map((resource) => [
        resource.id,
        resource.label,
        resource.attributes,
      ]),
      diagram.resources.map((resource) => [resource.id, resource.label, resource.attributes]),
    );
  });
  it('取り込み根拠と未解決を保持する', () => {
    const diagram = parsed();
    diagram.resources[0]!.provenance = {
      kind: 'plan',
      repository: '/repo',
      commit: 'abc',
      root: 'prod',
      address: 'module.app.aws_vpc.main',
      file: 'main.tf',
      line: 10,
    };
    diagram.resources[0]!.unresolved = ['account'];
    const restored = parseDSL(serializeDSL(diagram)).diagram!.resources[0]!;
    assert.deepEqual(restored.provenance, diagram.resources[0]!.provenance);
    assert.deepEqual(restored.unresolved, ['account']);
  });
  for (const [input, code, line, column] of [
    ['diagram "x" {\n aws.ecs x\n aws.rds x\n}', 'id.duplicate', 3, 10],
    ['diagram "x" {\n aws.ecs x subnets=[missing]\n}', 'reference.missing', 2, 21],
    ['diagram "x" {\n aws.ecs x surprise=true\n}', 'attribute.unknown', 2, 12],
    ['diagram "x" {\n aws.ecs x subnets="a"\n}', 'attribute.type', 2, 12],
    ['diagram "x" {\n aws.ecs x\n x -> y kind=deploy\n}', 'reference.missing', 3, 7],
    ['diagram "x" {\n aws.ecs x\n aws.ecs y subnets=[x]\n}', 'reference.type', 3, 21],
    ['diagram "x" {\n aws.ecs x\n x -> x port=70000\n}', 'attribute.type', 3, 9],
    ['diagram "x" {\n view overview level=[overview]\n}', 'attribute.type', 2, 16],
    ['diagram "x" {\n aws.ecs x\n x -> x kind=[traffic]\n}', 'attribute.type', 3, 9],
    ['diagram "x" {\n sg security {\n aws.ecs x\n }\n}', 'resource.boundary', 2, 14],
  ] as const)
    it(`不正入力の診断 ${code}: ${input}`, () => {
      const result = parseDSL(input as string);
      assert.equal(result.diagram, undefined);
      assert.ok(
        result.diagnostics.some(
          (item) => item.code === code && item.line === line && item.column === column,
        ),
        JSON.stringify(result.diagnostics),
      );
    });
  it('未知のサービスを代替表示用に保持する', () => {
    assert.equal(
      parseDSL('diagram "x" {\n custom.future service\n}').diagram!.resources[0]!.type,
      'custom.future',
    );
  });
  it('不正文字と未終端文字列を実行せず診断する', () => {
    assert.ok(parseDSL('diagram "x" {\n aws.ecs x label=`alert(1)`\n}').diagnostics.length > 0);
    assert.equal(parseDSL('diagram "unfinished').diagnostics[0]!.code, 'syntax.string');
  });
});

describe('表示集約', () => {
  it('SGを排他的境界にせず、複数所属をassociationとして表示する', () => {
    const graph = buildDisplayGraph(parsed(), { view: 'security' });
    assert.equal(
      graph.connections.filter(
        (edge) => edge.kind === 'association' && edge.target === 'api' && edge.source !== 'api',
      ).length,
      2,
    );
    assert.equal(graph.resources.find((resource) => resource.id === 'api')!.parentId, 'net');
  });
  it('折りたたみで方向とkindを保ち、展開で元の接続を復元する', () => {
    const diagram = parsed();
    const collapsed = buildDisplayGraph(diagram, { collapsed: ['prod'] });
    assert.ok(
      collapsed.connections.some(
        (edge) =>
          edge.source === 'ci' &&
          edge.target === 'prod' &&
          edge.kind === 'deploy' &&
          edge.originalIds[0] === 'edge-1',
      ),
    );
    assert.equal(collapsed.representative.api, 'prod');
    const restored = buildDisplayGraph(diagram);
    assert.deepEqual(
      restored.connections.map((edge) => [edge.source, edge.target, edge.kind]),
      diagram.connections.map((edge) => [edge.source, edge.target, edge.kind]),
    );
    assert.equal(diagram.resources.find((resource) => resource.id === 'api')!.parentId, 'net');
  });
  it('異なる方向・kind・protocolを別接続として保持する', () => {
    const diagram = parsed();
    diagram.connections.push(
      { id: 'extra', source: 'api', target: 'ci', kind: 'auth', attributes: {} },
      { id: 'extra2', source: 'db', target: 'ci', kind: 'auth', attributes: {} },
      { id: 'extra3', source: 'api', target: 'ci', kind: 'auth', attributes: { protocol: 'oidc' } },
    );
    const graph = buildDisplayGraph(diagram, { collapsed: ['prod'] });
    assert.equal(
      graph.connections.filter((edge) => edge.source === 'prod' && edge.target === 'ci').length,
      2,
    );
    assert.deepEqual(graph.connections.find((edge) => edge.id === 'extra')!.originalIds, [
      'extra',
      'extra2',
    ]);
  });
  it('自動折りたたみを展開し、明示的な折りたたみを優先する', () => {
    const diagram = parsed();
    const graph = buildDisplayGraph(diagram, { view: 'overview', expanded: ['prod'] });
    assert.ok(graph.resources.some((item) => item.id === 'api'));
    assert.equal(
      buildDisplayGraph(diagram, { view: 'overview', expanded: ['prod'], collapsed: ['prod'] })
        .representative.api,
      'prod',
    );
  });
  it('overviewでは管理境界に集約する', () => {
    assert.deepEqual(
      buildDisplayGraph(parsed(), { view: 'overview' }).resources.map((resource) => resource.id),
      ['prod', 'ci'],
    );
  });
});

describe('ELK 配置', () => {
  it('入れ子の線経路を絶対座標に変換し、端点を境界に接続して他ノード内部を避ける', async () => {
    const graph = buildDisplayGraph(parsed());
    const layout = await layoutGraph(graph);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const absolute = (
      id: string,
    ): { id: string; x: number; y: number; width: number; height: number } => {
      const node = byId.get(id)!;
      const parent = node.parentId ? absolute(node.parentId) : { x: 0, y: 0 };
      return { ...node, x: node.x + parent.x, y: node.y + parent.y };
    };
    const leafNodes = graph.resources
      .filter((resource) => !graph.resources.some((item) => item.parentId === resource.id))
      .map((resource) => absolute(resource.id));
    assert.equal(layout.edges!.length, graph.connections.length);
    for (const edge of graph.connections) {
      const route = layout.edges!.find((item) => item.id === edge.id)!;
      assert.ok(route.points.length >= 2);
      const source = absolute(edge.source),
        target = absolute(edge.target);
      const onBoundary = (point: { x: number; y: number }, rect: typeof source): boolean =>
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height &&
        (point.x === rect.x ||
          point.x === rect.x + rect.width ||
          point.y === rect.y ||
          point.y === rect.y + rect.height);
      assert.ok(onBoundary(route.points[0]!, source), `source offset ${edge.id}`);
      assert.ok(onBoundary(route.points.at(-1)!, target), `target offset ${edge.id}`);
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1]!,
          b = route.points[i]!;
        assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'orthogonal route');
        for (const rect of leafNodes) {
          const intersects =
            Math.abs(a.x - b.x) < 1e-6
              ? a.x > rect.x &&
                a.x < rect.x + rect.width &&
                Math.max(a.y, b.y) > rect.y &&
                Math.min(a.y, b.y) < rect.y + rect.height
              : a.y > rect.y &&
                a.y < rect.y + rect.height &&
                Math.max(a.x, b.x) > rect.x &&
                Math.min(a.x, b.x) < rect.x + rect.width;
          assert.equal(intersects, false, `line ${edge.id} crosses ${rect.id}`);
        }
      }
      assert.ok(route.label);
      for (const rect of leafNodes)
        assert.ok(
          !(
            route.label!.x > rect.x &&
            route.label!.x < rect.x + rect.width &&
            route.label!.y > rect.y &&
            route.label!.y < rect.y + rect.height
          ),
          `label ${edge.id} inside ${rect.id}`,
        );
    }
  });
  it('同じ入力の配置を再現し、親境界内へ配置する', async () => {
    const graph = buildDisplayGraph(parsed());
    const first = await layoutGraph(graph);
    const second = await layoutGraph(graph);
    assert.deepEqual(first.nodes, second.nodes);
    assert.deepEqual(first.edges, second.edges);
    for (const node of first.nodes) {
      assert.ok(Number.isFinite(node.x));
      if (node.parentId) {
        const parent = first.nodes.find((item) => item.id === node.parentId)!;
        assert.ok(node.x + node.width <= parent.width);
        assert.ok(node.y + node.height <= parent.height);
      }
    }
  });
});

describe('外部 JSON の共通検証', () => {
  it('DSL の解析結果と JSON を同じ共通モデルとして受け付ける', () => {
    const diagram = parsed();
    assert.equal(validateDiagram(diagram), diagram);
    assert.deepEqual(validateDiagram(JSON.parse(JSON.stringify(diagram))), diagram);
  });
  const invalid: [string, (diagram: Diagram) => void][] = [
    [
      '親循環',
      (diagram) => {
        diagram.resources[0]!.parentId = 'net';
      },
    ],
    [
      '存在しない親',
      (diagram) => {
        diagram.resources[0]!.parentId = 'missing';
      },
    ],
    [
      'SG の排他的入れ子',
      (diagram) => {
        diagram.resources.find((resource) => resource.id === 'api')!.parentId = 'one';
      },
    ],
    [
      '存在しない接続端点',
      (diagram) => {
        diagram.connections[0]!.target = 'missing';
      },
    ],
    [
      '非有限値の属性',
      (diagram) => {
        diagram.resources[0]!.attributes.bad = Infinity;
      },
    ],
    [
      '数値配列の属性',
      (diagram) => {
        Object.assign(diagram.resources[0]!.attributes, { bad: [12] });
      },
    ],
    [
      '存在しない配列参照',
      (diagram) => {
        diagram.resources.find((resource) => resource.id === 'api')!.attributes.subnets = [
          'missing',
        ];
      },
    ],
    [
      'Subnet の種別誤り',
      (diagram) => {
        diagram.resources.find((resource) => resource.id === 'api')!.attributes.subnets = ['db'];
      },
    ],
    [
      'view と resource の重複 ID',
      (diagram) => {
        diagram.views[0]!.id = 'api';
      },
    ],
    [
      'view overlay の誤り',
      (diagram) => {
        diagram.views[0]!.overlay = 'javascript';
      },
    ],
    [
      'view direction の誤り',
      (diagram) => {
        Object.assign(diagram.views[0]!, { direction: 'LEFT' });
      },
    ],
    [
      '診断ソース位置の誤り',
      (diagram) => {
        diagram.diagnostics.push({
          code: 'error',
          message: 'x',
          severity: 'error',
          line: -1,
          column: 1,
        });
      },
    ],
    [
      '診断severityの誤り',
      (diagram) => {
        Object.assign(diagram, {
          diagnostics: [{ code: 'error', message: 'x', severity: 'fatal', line: 1, column: 1 }],
        });
      },
    ],
    [
      'provenance ソース情報の誤り',
      (diagram) => {
        Object.assign(diagram.resources[0]!, { provenance: { kind: 'plan', file: 12 } });
      },
    ],
    [
      'provenance kind の誤り',
      (diagram) => {
        Object.assign(diagram.resources[0]!, { provenance: { kind: 'live' } });
      },
    ],
    [
      '未解決情報の型誤り',
      (diagram) => {
        Object.assign(diagram.resources[0]!, { unresolved: { account: 'unknown' } });
      },
    ],
    [
      '接続属性の型誤り',
      (diagram) => {
        diagram.connections[0]!.attributes.protocol = true;
      },
    ],
  ];
  for (const [label, mutate] of invalid)
    it(`${label}を拒否する`, () => {
      const diagram = parsed();
      mutate(diagram);
      assert.throws(() => validateDiagram(diagram));
    });
  it('constructor ID を名前空間の通常 ID として扱う', () => {
    const diagram = parseDSL(
      'diagram "x" {\n aws.ecs constructor\n aws.rds database\n constructor -> database kind=dependency\n}',
    ).diagram!;
    validateDiagram(diagram);
    const graph = buildDisplayGraph(diagram);
    assert.equal(graph.representative.constructor, 'constructor');
    assert.equal(graph.connections[0]!.source, 'constructor');
  });
  it('外部ライブラリからの配置呼び出しでも親循環を拒否する', async () => {
    const graph = buildDisplayGraph(parsed());
    graph.resources.find((resource) => resource.id === 'prod')!.parentId = 'net';
    await assert.rejects(layoutGraph(graph), /循環/);
  });
});

it('ECS・Beanstalk の詳細境界は折りたたみで集約し、展開で関係を復元する', async () => {
  const { readFileSync } = await import('node:fs');
  const parsed = parseDSL(readFileSync('examples/ecs-beanstalk.infra', 'utf8'));
  assert.deepEqual(parsed.diagnostics, []);
  const diagram = validateDiagram(parsed.diagram);
  const full = buildDisplayGraph(diagram);
  const folded = buildDisplayGraph(diagram, { collapsed: ['cluster', 'web', 'definition'] });
  assert.equal(folded.representative.task_a, 'cluster');
  assert.equal(folded.representative.instance, 'web');
  assert.equal(folded.representative.container_definition, 'definition');
  assert.ok(
    folded.connections.some((edge) => edge.source === 'cluster' && edge.target === 'definition'),
  );
  assert.deepEqual(
    buildDisplayGraph(diagram, { expanded: ['cluster', 'web', 'definition'] }),
    full,
  );
  const restored = parseDSL(serializeDSL(diagram));
  assert.deepEqual(restored.diagnostics, []);
  assert.equal(restored.diagram?.resources.length, diagram.resources.length);
  const layout = await layoutGraph(full);
  assert.equal(layout.nodes.length, diagram.resources.length);
});

it('共有TGW・VPNの跨る接続は所属を変えず、折りたたみ解除で端点とkindを復元する', async () => {
  const { readFileSync } = await import('node:fs');
  const diagram = validateDiagram(
    parseDSL(readFileSync('examples/transit-vpn.infra', 'utf8')).diagram,
  );
  assert.equal(diagram.resources.filter((r) => r.type === 'gcp.vpn-tunnel').length, 4);
  const full = buildDisplayGraph(diagram);
  const folded = buildDisplayGraph(diagram, { collapsed: ['hub', 'prod', 'dev', 'gcp'] });
  assert.equal(folded.resources.length, 4);
  assert.ok(
    folded.connections.some((e) => e.source === 'hub' && e.target === 'prod' && e.kind === 'auth'),
  );
  assert.ok(
    folded.connections.some(
      (e) => e.source === 'gcp' && e.target === 'hub' && e.kind === 'association',
    ),
  );
  assert.deepEqual(buildDisplayGraph(diagram), full);
  assert.equal(diagram.resources.find((r) => r.id === 'prod_attachment')?.parentId, 'prod_tokyo');
  const layout = await layoutGraph(full);
  assert.equal(layout.nodes.length, 28);
});

it('Organizationsの入れ子OUを折りたたみ、ポリシーとRAM共有の端点を復元する', async () => {
  const { readFileSync } = await import('node:fs');
  const diagram = validateDiagram(
    parseDSL(readFileSync('examples/organizations.infra', 'utf8')).diagram,
  );
  const full = buildDisplayGraph(diagram);
  const folded = buildDisplayGraph(diagram, { collapsed: ['workloads'] });
  assert.ok(
    folded.connections.some(
      (e) => e.source === 'scp' && e.target === 'workloads' && e.kind === 'association',
    ),
  );
  assert.ok(
    folded.connections.some(
      (e) => e.source === 'ram' && e.target === 'workloads' && e.kind === 'auth',
    ),
  );
  assert.deepEqual(buildDisplayGraph(diagram), full);
  const overview = buildDisplayGraph(diagram, { view: 'overview' });
  assert.ok(!overview.resources.some((r) => r.id === 'tgw'));
  assert.ok(overview.resources.some((r) => r.id === 'network_account'));
  assert.equal(
    (await layoutGraph(full, { direction: 'DOWN' })).nodes.length,
    diagram.resources.length,
  );
});

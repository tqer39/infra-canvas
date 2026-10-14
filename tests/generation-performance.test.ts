import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { modelDSL, retainSourceEvidence } from '../src/assistant/model-context.js';
import { buildMessages, validateDraft } from '../src/assistant/contract.js';
import { LocalModel, type GenerationStats } from '../src/assistant/local-model.js';

const source = `diagram "Source" {
 vpc net "VPC" cidr="10.0.0.0/16" sourceKind=static repository="https://github.com/example/app" commit="abc" file="main.tf" line=5 meta.sources="main.tf:5" evidence=inferred {
  subnet app "Private" private az="ap-northeast-1a" {
   aws.ec2 api "API" securityGroups=[sg_api] evidence=unknown unresolved=["instance_type"]
  }
  sg sg_api "API SG" ingress=["tcp 443 10.0.0.0/16"] egress=[]
 }
 view service level=resource
}`;
it('モデル向けDSLは重複した出典だけを省き、所属・SG・未解決事項を保持する', () => {
  const compact = modelDSL(source);
  assert.ok(compact.length < source.length);
  assert.doesNotMatch(compact, /sourceKind|repository=|commit=|meta.sources/);
  const draft = validateDraft({ message: '', dsl: compact, warnings: [] });
  assert.equal(draft.diagram.resources.find((r) => r.id === 'api')?.parentId, 'app');
  assert.deepEqual(draft.diagram.resources.find((r) => r.id === 'api')?.attributes.securityGroups, [
    'sg_api',
  ]);
  assert.deepEqual(draft.diagram.resources.find((r) => r.id === 'api')?.unresolved, [
    'instance_type',
  ]);
  assert.equal(draft.diagram.resources.find((r) => r.id === 'api')?.attributes.evidence, 'unknown');
  const restored = retainSourceEvidence(draft.diagram, source);
  const vpc = restored.resources.find((r) => r.id === 'net')!;
  assert.equal(vpc.provenance?.file, 'main.tf');
  assert.equal(vpc.attributes['meta.sources'], 'main.tf:5');
  assert.equal(
    validateDraft({ message: '', dsl: modelDSL(source), warnings: [] }).diagram.resources.length,
    4,
  );
  assert.doesNotMatch(buildMessages(source, '説明', []).messages[1].content, /repository=/);
  assert.equal(modelDSL('invalid'), 'invalid');
});
it('構成が変わったリソースや新規リソースには元の静的根拠を付けない', () => {
  const draft = validateDraft({ message: '', dsl: modelDSL(source), warnings: [] });
  draft.diagram.resources.find((r) => r.id === 'net')!.attributes.cidr = '10.1.0.0/16';
  draft.diagram.resources.push({
    id: 'new',
    type: 'external.service',
    label: 'New',
    attributes: {},
  });
  const restored = retainSourceEvidence(draft.diagram, source);
  assert.notEqual(restored.resources.find((r) => r.id === 'net')?.provenance?.kind, 'static');
  assert.equal(
    restored.resources.find((r) => r.id === 'net')?.attributes['meta.sources'],
    undefined,
  );
  assert.equal(restored.resources.find((r) => r.id === 'new')?.provenance, undefined);
});
it('ストリーム先頭と空のusageチャンクを通知し、実測速度を取得する', async () => {
  const model = new LocalModel();
  const events: { count: number; stats?: GenerationStats }[] = [];
  const engine = {
    chat: {
      completions: {
        create: async (request: { stream_options: { include_usage: boolean } }) => {
          assert.equal(request.stream_options.include_usage, true);
          return (async function* () {
            yield { choices: [{ delta: { content: '{' }, finish_reason: null }] };
            yield { choices: [{ delta: { content: '}' }, finish_reason: 'stop' }] };
            yield {
              choices: [],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 2,
                extra: { time_to_first_token_s: 0.5, decode_tokens_per_s: 10 },
              },
            };
          })();
        },
      },
    },
  };
  (model as unknown as { engine: MLCEngineInterface }).engine =
    engine as unknown as MLCEngineInterface;
  assert.equal(await model.complete([], (count, stats) => events.push({ count, stats })), '{}');
  assert.equal(events[0].count, 1);
  assert.deepEqual(events.at(-1)?.stats, {
    inputTokens: 100,
    outputTokens: 2,
    firstTokenSeconds: 0.5,
    tokensPerSecond: 10,
  });
});

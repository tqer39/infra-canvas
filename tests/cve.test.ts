import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cveDiagram, fetchRecentCves, normalizeCve } from '../src/cve/nvd';
import { serializeDSL } from '../src/core/serialize';
import { parseDSL } from '../src/core/parser';

const sample = {
  id: 'CVE-2026-12345',
  published: '2026-10-30T00:00:00.000',
  lastModified: '2026-10-31T00:00:00.000',
  vulnStatus: 'Awaiting Analysis',
  descriptions: [{ lang: 'en', value: 'An issue in a component.' }],
  affected: [
    {
      source: 'example CNA',
      affectedData: [
        {
          vendor: 'Example',
          product: 'Library',
          versions: [{ version: '1.0', lessThan: '2.0', status: 'affected' }],
        },
      ],
    },
  ],
  references: [{ url: 'https://example.org/advisory' }, { url: 'javascript:alert(1)' }],
};

test('公開期間で取得し、対象情報と出典を図と DSL に保存する', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('pubStartDate'), '2026-10-24T00:00:00.000Z');
    assert.equal(url.searchParams.get('pubEndDate'), '2026-10-31T00:00:00.000Z');
    return Response.json({ totalResults: 1, startIndex: 0, vulnerabilities: [{ cve: sample }] });
  };
  const snapshot = await fetchRecentCves(new Date('2026-10-31T00:00:00Z'), fetcher);
  assert.equal(snapshot.records.length, 1);
  assert.deepEqual(snapshot.records[0]!.references, ['https://example.org/advisory']);
  const parsed = parseDSL(serializeDSL(cveDiagram(snapshot.records[0]!)));
  assert.ok(parsed.diagram, JSON.stringify(parsed.diagnostics));
  assert.equal(parsed.diagram.resources[2]?.label, 'Example / Library');
  assert.match(
    String(parsed.diagram.resources[2]?.attributes.description),
    /1\.0 < 2\.0 \(affected\)/,
  );
  assert.match(String(parsed.diagram.resources[0]?.attributes.url), /CVE-2026-12345/);
  assert.equal(parsed.diagram.connections[0]?.kind, 'association');
  assert.ok(parsed.diagram.resources[0]?.unresolved?.length);
});

test('対象が不明な場合は未解決として残し、通信関係を作らない', () => {
  const record = normalizeCve({ ...sample, affected: [] });
  const diagram = cveDiagram(record);
  assert.equal(diagram.connections.length, 0);
  assert.match(diagram.resources[0]!.unresolved!.join(' '), /対象製品情報/);
});

test('取得失敗や欠落したページは成功扱いしない', async () => {
  await assert.rejects(
    fetchRecentCves(new Date(), async () => new Response('', { status: 429 })),
    /429/,
  );
  await assert.rejects(
    fetchRecentCves(new Date(), async () =>
      Response.json({ totalResults: 2, startIndex: 0, vulnerabilities: [] }),
    ),
    /読み取れません/,
  );
});

test('複数ページを読み込み、重複や途中の件数変化を検出する', async () => {
  const noWait = async () => {};
  const fetcher: typeof fetch = async (input) => {
    const index = Number(new URL(String(input)).searchParams.get('startIndex'));
    return Response.json({
      totalResults: 2,
      startIndex: index,
      vulnerabilities: [{ cve: { ...sample, id: index ? 'CVE-2026-12346' : sample.id } }],
    });
  };
  const result = await fetchRecentCves(new Date(), fetcher, noWait);
  assert.equal(result.records.length, 2);
  const duplicate: typeof fetch = async (input) =>
    Response.json({
      totalResults: 2,
      startIndex: Number(new URL(String(input)).searchParams.get('startIndex')),
      vulnerabilities: [{ cve: sample }],
    });
  await assert.rejects(fetchRecentCves(new Date(), duplicate, noWait), /重複/);
  const changed: typeof fetch = async (input) => {
    const index = Number(new URL(String(input)).searchParams.get('startIndex'));
    return Response.json({
      totalResults: index ? 3 : 2,
      startIndex: index,
      vulnerabilities: [{ cve: sample }],
    });
  };
  await assert.rejects(fetchRecentCves(new Date(), changed, noWait), /件数が変わりました/);
});

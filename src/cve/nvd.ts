import type { Diagram, Resource, Connection } from '../core/model';

export interface CveProduct {
  vendor: string;
  product: string;
  versions: string[];
  source: string;
  ecosystem?: string;
}
export interface CveRecord {
  id: string;
  source?: string;
  sourceUrl?: string;
  aliases?: string[];
  retrievedAt?: string;
  published: string;
  modified: string;
  status: string;
  description: string;
  products: CveProduct[];
  references: string[];
}
export interface CveSnapshot {
  start: string;
  end: string;
  fetchedAt: string;
  records: CveRecord[];
  origin?: 'catalog';
  dateField?: 'published' | 'modified';
}

export function isCveSnapshot(value: unknown, allowCatalog = false): value is CveSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as CveSnapshot;
  const str = (item: unknown): item is string => typeof item === 'string';
  const url = (item: unknown): boolean => {
    if (!str(item)) return false;
    try {
      return ['http:', 'https:'].includes(new URL(item).protocol);
    } catch {
      return false;
    }
  };
  const catalog = allowCatalog && snapshot.origin === 'catalog';
  return (
    (snapshot.origin === undefined || catalog) &&
    (snapshot.dateField === undefined || ['published', 'modified'].includes(snapshot.dateField)) &&
    str(snapshot.start) &&
    str(snapshot.end) &&
    str(snapshot.fetchedAt) &&
    Array.isArray(snapshot.records) &&
    snapshot.records.every(
      (record) =>
        record &&
        str(record.id) &&
        (catalog
          ? /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(record.id)
          : /^CVE-\d{4}-\d{4,}$/.test(record.id)) &&
        (record.source === undefined || str(record.source)) &&
        (record.sourceUrl === undefined || url(record.sourceUrl)) &&
        (record.retrievedAt === undefined || str(record.retrievedAt)) &&
        (record.aliases === undefined ||
          (Array.isArray(record.aliases) && record.aliases.every(str))) &&
        str(record.published) &&
        str(record.modified) &&
        str(record.status) &&
        str(record.description) &&
        Array.isArray(record.references) &&
        record.references.every(url) &&
        Array.isArray(record.products) &&
        record.products.every(
          (product) =>
            product &&
            str(product.vendor) &&
            str(product.product) &&
            str(product.source) &&
            (product.ecosystem === undefined || str(product.ecosystem)) &&
            Array.isArray(product.versions) &&
            product.versions.every(str),
        ),
    )
  );
}

type NvdCve = {
  id: string;
  published: string;
  lastModified: string;
  vulnStatus: string;
  descriptions?: { lang: string; value: string }[];
  references?: { url: string }[];
  affected?: {
    source: string;
    affectedData?: {
      vendor?: string;
      product?: string;
      versions?: {
        version?: string;
        status?: string;
        lessThan?: string;
        lessThanOrEqual?: string;
      }[];
    }[];
  }[];
};

export function normalizeCve(cve: NvdCve): CveRecord {
  const products = (cve.affected ?? []).flatMap((block) =>
    (block.affectedData ?? [])
      .filter((item) => item.product && item.product !== 'n/a')
      .map((item) => ({
        vendor: item.vendor && item.vendor !== 'n/a' ? item.vendor : '提供元不明',
        product: item.product!,
        source: block.source,
        versions: (item.versions ?? []).map((version) =>
          [
            version.version,
            version.lessThan && `< ${version.lessThan}`,
            version.lessThanOrEqual && `≤ ${version.lessThanOrEqual}`,
            version.status && `(${version.status})`,
          ]
            .filter(Boolean)
            .join(' '),
        ),
      })),
  );
  return {
    id: cve.id,
    published: cve.published,
    modified: cve.lastModified,
    status: cve.vulnStatus,
    description:
      cve.descriptions?.find((item) => item.lang === 'en')?.value ??
      cve.descriptions?.[0]?.value ??
      '説明情報なし',
    products,
    references: (cve.references ?? [])
      .map((reference) => reference.url)
      .filter((url) => /^https?:\/\//i.test(url)),
  };
}

export async function fetchRecentCves(
  now = new Date(),
  fetcher: typeof fetch = fetch,
  wait: () => Promise<unknown> = () => new Promise((resolve) => setTimeout(resolve, 6500)),
  signal?: AbortSignal,
): Promise<CveSnapshot> {
  const end = now.toISOString();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const records: CveRecord[] = [];
  let total: number;
  let expectedTotal: number | undefined;
  let index = 0;
  const ids = new Set<string>();
  do {
    if (index) await wait();
    signal?.throwIfAborted();
    const url = new URL('https://services.nvd.nist.gov/rest/json/cves/2.0');
    url.search = new URLSearchParams({
      pubStartDate: start,
      pubEndDate: end,
      resultsPerPage: '2000',
      startIndex: String(index),
    }).toString();
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error(`NVD の取得に失敗しました（HTTP ${response.status}）。`);
    const page = (await response.json()) as {
      totalResults: number;
      startIndex: number;
      vulnerabilities: { cve: NvdCve }[];
    };
    if (
      !Number.isInteger(page.totalResults) ||
      page.startIndex !== index ||
      !Array.isArray(page.vulnerabilities) ||
      (page.vulnerabilities.length === 0 && index < page.totalResults)
    )
      throw new Error('NVD の応答を読み取れませんでした。');
    total = page.totalResults;
    if (expectedTotal !== undefined && total !== expectedTotal)
      throw new Error('取得中に NVD の件数が変わりました。もう一度取得してください。');
    expectedTotal = total;
    for (const { cve } of page.vulnerabilities) {
      if (!cve || typeof cve.id !== 'string' || ids.has(cve.id))
        throw new Error('NVD の一覧に重複または不正な項目があります。もう一度取得してください。');
      ids.add(cve.id);
      records.push(normalizeCve(cve));
    }
    index += page.vulnerabilities.length;
  } while (index < total);
  const snapshot = { start, end, fetchedAt: new Date().toISOString(), records };
  if (!isCveSnapshot(snapshot)) throw new Error('NVD の応答を読み取れませんでした。');
  return snapshot;
}

export function cveDiagram(record: CveRecord): Diagram {
  const url =
    record.sourceUrl ?? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(record.id)}`;
  const resources: Resource[] = [
    {
      id: 'cve',
      type: 'security.vulnerability',
      label: record.id,
      attributes: {
        description: `${record.description}\n公開: ${record.published} / 更新: ${record.modified}\n参照: ${record.references.join('\n') || 'なし'}`,
        url,
        status: record.status,
      },
      unresolved: [
        '攻撃経路、構成および実環境への影響は未確認。原資料を確認してください。',
        ...(record.products.length
          ? []
          : ['構造化された対象製品情報はありません。原資料を確認してください。']),
      ],
    },
  ];
  resources.push({
    id: 'summary',
    type: 'note',
    label: record.source ? `${record.source} の説明（原文）` : 'NVD の説明（原文）',
    attributes: { anchor: 'cve', description: record.description },
  });
  const connections: Connection[] = [];
  record.products.forEach((product, index) => {
    const id = `product_${index}`;
    resources.push({
      id,
      type: 'software.component',
      label: [product.vendor, product.product].filter(Boolean).join(' / '),
      attributes: {
        description: `${record.source ?? 'NVD'} の対象情報（提供元: ${product.source}）\n${product.versions.join('\n') || 'バージョン情報なし'}`,
        url,
      },
    });
    connections.push({
      id: `association_${index}`,
      source: 'cve',
      target: id,
      kind: 'association',
      attributes: {
        label: '対象情報',
        description: 'NVD の製品情報との関連。実際の利用や影響を示すものではありません。',
      },
    });
  });
  return {
    version: 1,
    title: `${record.id} の公開情報`,
    resources,
    connections,
    views: [{ id: 'service', level: 'resource' }],
    diagnostics: [],
  };
}

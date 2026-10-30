import type { CveRecord, CveSnapshot } from './nvd';

/** vulnerability-catalog/v1 以外の形式を受け入れず、出典 URL も検証する。 */
export function catalogSnapshot(value: unknown): CveSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const text = (item: unknown): item is string => typeof item === 'string';
  const url = (item: unknown): item is string => {
    if (!text(item)) return false;
    try {
      return ['http:', 'https:'].includes(new URL(item).protocol);
    } catch {
      return false;
    }
  };
  if (
    data.schema !== 'vulnerability-catalog/v1' ||
    !text(data.start) ||
    !text(data.end) ||
    !text(data.exportedAt) ||
    !['published', 'modified'].includes(String(data.dateField)) ||
    !Array.isArray(data.records)
  )
    return undefined;
  const records: CveRecord[] = [];
  for (const item of data.records) {
    if (!item || typeof item !== 'object') return undefined;
    const record = item as Record<string, unknown>;
    if (
      !text(record.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(record.id) ||
      !text(record.source) ||
      !url(record.sourceUrl) ||
      !text(record.published) ||
      !text(record.modified) ||
      (record.retrievedAt !== undefined && !text(record.retrievedAt)) ||
      !text(record.status) ||
      !text(record.description) ||
      !Array.isArray(record.aliases) ||
      !record.aliases.every(text) ||
      !Array.isArray(record.references) ||
      !record.references.every(url) ||
      !Array.isArray(record.products)
    )
      return undefined;
    for (const value of record.products) {
      if (!value || typeof value !== 'object') return undefined;
      const product = value as Record<string, unknown>;
      if (
        !text(product.vendor) ||
        !text(product.product) ||
        !text(product.source) ||
        !text(product.ecosystem) ||
        !Array.isArray(product.versions) ||
        !product.versions.every(text)
      )
        return undefined;
    }
    records.push(record as unknown as CveRecord);
  }
  return {
    start: data.start,
    end: data.end,
    fetchedAt: data.exportedAt,
    records,
    origin: 'catalog',
    dateField: data.dateField as 'published' | 'modified',
  };
}

import countries from './region-countries.json';
import type { Resource } from '../core/model';

const regions = new Map(
  Object.entries(countries).flatMap(([code, country]) =>
    country.regions.map((region) => [region, { code, name: country.name }] as const),
  ),
);

// 完全一致した地域コードのみ使い、表示名・ID・親の所属から国を推測しない。
export function getRegionCountry(region: unknown) {
  return typeof region === 'string' ? regions.get(region.trim().toLowerCase()) : undefined;
}

export function getResourceRegion(resource: Resource): string | undefined {
  const region = resource.attributes.region;
  return typeof region === 'string' ? region : undefined;
}

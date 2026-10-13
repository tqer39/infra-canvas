import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getRegionCountry } from '../src/assets/regions';
import countries from '../src/assets/region-countries.json';
import manifest from '../src/assets/flags/manifest.json';

test('同じ日本でも異なるクラウドのリージョンコードを国に対応づける', () => {
  for (const region of [
    'ap-northeast-1',
    'ap-northeast-3',
    'asia-northeast1',
    'asia-northeast2',
    'japaneast',
    'japanwest',
  ]) {
    assert.deepEqual(getRegionCountry(region), { code: 'JP', name: '日本' });
  }
  // 番号や方角の類似から誤判定しない。
  assert.equal(getRegionCountry('ap-northeast-2')?.code, 'KR');
  assert.equal(getRegionCountry('asia-northeast3')?.code, 'KR');
  assert.equal(getRegionCountry('eu-west-1')?.code, 'IE');
  assert.equal(getRegionCountry('europe-west1')?.code, 'BE');
  assert.equal(getRegionCountry('eastasia')?.code, 'HK');
  assert.equal(getRegionCountry('southeastasia')?.code, 'SG');
  assert.equal(getRegionCountry('  JapanEast ')?.code, 'JP');
});

test('未知・グローバル・複数地域・型の不正な入力から国を推測しない', () => {
  for (const region of [
    undefined,
    null,
    123,
    ['japaneast'],
    'global',
    'eu',
    'us',
    'Tokyo',
    'ap-northeast-99',
    'ap-northeast-1a',
    'asia-northeast1-a',
    '__proto__',
    'constructor',
  ]) {
    assert.equal(getRegionCountry(region), undefined);
  }
});

test('リージョンコードの重複がなく、全対応国旗が原本のハッシュと一致する', () => {
  const codes = Object.values(countries).flatMap((country) => country.regions);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(
    manifest.files.map((file) => file.country).sort(),
    Object.keys(countries).sort(),
  );
  for (const asset of manifest.files) {
    const svg = readFileSync(`src/assets/flags/${asset.file}`, 'utf8');
    assert.equal(createHash('sha256').update(svg).digest('hex'), asset.sha256);
    assert.match(svg, /<svg\b/);
    assert.doesNotMatch(svg, /<script\b|<image\b|(?:href|src)=["']https?:/i);
  }
});

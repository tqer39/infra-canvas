import type { Resource } from './model.js';

/** 設定は不活性な文字列。ファイル参照・テンプレート・シェルは解釈しない。 */
export function validateConfiguration(resource: Resource): void {
  const { config, configFormat } = resource.attributes;
  if (config !== undefined && typeof config !== 'string')
    throw new Error('config は文字列で指定してください。');
  if (
    configFormat !== undefined &&
    (!['nginx', 'yaml', 'json', 'text'].includes(String(configFormat)) ||
      typeof config !== 'string')
  )
    throw new Error(
      'configFormat は nginx・yaml・json・text のいずれかで、config と合わせて指定してください。',
    );
}

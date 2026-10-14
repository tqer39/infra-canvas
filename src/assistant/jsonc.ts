export function parseJSONC(source: string): Record<string, unknown> {
  let clean = '',
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      clean += char;
      if (char === '\\') clean += source[++i] ?? '';
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      clean += char;
    } else if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end - 1;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
      clean += ' ';
    } else if (char === ',' && /^\s*[}\]]/.test(source.slice(i + 1))) continue;
    else clean += char;
  }
  let normalized = '';
  quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      normalized += char;
      if (char === '\\') normalized += clean[++i] ?? '';
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      normalized += char;
    } else if (char === ',' && /^\s*[}\]]/.test(clean.slice(i + 1))) continue;
    else normalized += char;
  }
  const value: unknown = JSON.parse(normalized);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('設定はJSONオブジェクトです。');
  return value as Record<string, unknown>;
}

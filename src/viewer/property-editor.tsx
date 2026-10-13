import { useId, useState } from 'react';
import {
  textAttributes,
  arrayAttributes,
  numberAttributes,
  boolAttributes,
} from '../core/attribute-schema';
import type { Attributes, Connection, Resource } from '../core/model';

const reserved = new Set([
  'sourceKind',
  'repository',
  'commit',
  'root',
  'address',
  'file',
  'line',
  'provenance',
  'unresolved',
]);
const names: Record<string, string> = {
  config: 'サービス設定',
  configFormat: '設定形式',
  replicas: 'レプリカ数',
  cpuRequest: 'CPU request',
  memoryRequest: 'メモリ request',
  cpuLimit: 'CPU limit',
  memoryLimit: 'メモリ limit',
  cpu: 'CPU (units)',
  memory: 'メモリ (MiB)',
  desiredCount: '希望タスク数',
  region: 'リージョン',
  az: 'AZ',
  account: 'アカウントID',
  cidr: 'CIDR',
  subnets: 'Subnet の ID',
  securityGroups: 'Security Group の ID',
  launchType: '実行方式',
  signals: '送信データ',
  port: 'ポート',
  protocol: 'プロトコル',
  label: 'ラベル',
  description: '説明',
};
const enums: Record<string, string[]> = {
  configFormat: ['nginx', 'yaml', 'json', 'text'],
  launchType: ['FARGATE', 'EC2', 'EXTERNAL'],
  display: ['table', 'list'],
  subnetType: ['public', 'private'],
};
type Field = { key: string; type: 'string' | 'number' | 'boolean' | 'array'; value: string };
const fieldsFor = (attrs: Attributes): Field[] =>
  Object.entries(attrs)
    .filter(([key]) => !reserved.has(key))
    .map(([key, value]) => ({
      key,
      type: Array.isArray(value) ? 'array' : (typeof value as Field['type']),
      value: Array.isArray(value) ? value.join('\n') : String(value),
    }));

/** 下書きは選択アイテムごとに独立し、反映前にモデル全体を検証する。 */
export function PropertyEditor({
  resource,
  connection,
  onSave,
}: {
  resource?: Resource;
  connection?: Connection;
  onSave: (value: { label: string; kind: Connection['kind']; attributes: Attributes }) => void;
}) {
  const item = resource ?? connection!;
  const optionsId = useId();
  const [fields, setFields] = useState(() => fieldsFor(item.attributes));
  const [label, setLabel] = useState(resource?.label ?? '');
  const [kind, setKind] = useState<Connection['kind']>(connection?.kind ?? 'traffic');
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const supported = resource
    ? [...textAttributes, ...arrayAttributes, ...numberAttributes, ...boolAttributes].filter(
        (key) => !reserved.has(key),
      )
    : ['label', 'protocol', 'port', 'description', 'signals'];
  const change = (key: string, value: string) => {
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, value } : field)),
    );
    setSaved(false);
  };
  const reset = () => {
    setFields(fieldsFor(item.attributes));
    setLabel(resource?.label ?? '');
    setKind(connection?.kind ?? 'traffic');
    setError('');
    setSaved(false);
  };
  return (
    <form
      className="property-editor"
      aria-label={resource ? 'リソース情報の編集' : `接続 ${connection!.id} の編集`}
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const attributes: Attributes = Object.fromEntries(
            Object.entries(item.attributes).filter(([key]) => reserved.has(key)),
          );
          for (const field of fields) {
            if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(field.key))
              throw new Error('属性名を確認してください。');
            if (
              field.type === 'number' &&
              (!field.value.trim() || !Number.isFinite(Number(field.value)))
            )
              throw new Error(`${names[field.key] ?? field.key} は数値で指定してください。`);
            attributes[field.key] =
              field.type === 'number'
                ? Number(field.value)
                : field.type === 'boolean'
                  ? field.value === 'true'
                  : field.type === 'array'
                    ? field.value === ''
                      ? []
                      : field.value.split('\n')
                    : field.value;
          }
          onSave({ label, kind, attributes });
          setError('');
          setSaved(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setSaved(false);
        }
      }}
    >
      {resource ? (
        <label>
          名前
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setSaved(false);
            }}
          />
        </label>
      ) : (
        <label>
          接続の種類
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Connection['kind']);
              setSaved(false);
            }}
          >
            <option value="traffic">通信</option>
            <option value="dependency">依存</option>
            <option value="auth">認証</option>
            <option value="deploy">デプロイ</option>
            <option value="association">関連</option>
          </select>
        </label>
      )}
      {fields.map((field) => (
        <div className="property-field" key={field.key}>
          <label>
            {names[field.key] ?? field.key}
            {field.type === 'array' || field.key === 'config' ? (
              <textarea
                aria-label={names[field.key] ?? field.key}
                value={field.value}
                rows={field.key === 'config' ? 10 : 3}
                placeholder={field.key === 'config' ? '設定内容（実行されません）' : '1行に1項目'}
                onChange={(e) => change(field.key, e.target.value)}
              />
            ) : field.type === 'boolean' || enums[field.key] ? (
              <select
                aria-label={names[field.key] ?? field.key}
                value={field.value}
                onChange={(e) => change(field.key, e.target.value)}
              >
                {[
                  ...new Set([
                    field.value,
                    ...(field.type === 'boolean' ? ['true', 'false'] : enums[field.key]!),
                  ]),
                ].map((value) => (
                  <option key={value} value={value}>
                    {value || '未指定'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={names[field.key] ?? field.key}
                type={field.type === 'number' ? 'number' : 'text'}
                step="any"
                value={field.value}
                onChange={(e) => change(field.key, e.target.value)}
              />
            )}
          </label>
          <button
            type="button"
            className="property-remove"
            aria-label={`${field.key} を削除`}
            onClick={() => {
              setFields((current) => current.filter((f) => f.key !== field.key));
              setSaved(false);
            }}
          >
            削除
          </button>
        </div>
      ))}
      <label>
        追加する属性
        <input
          list={optionsId}
          value={newKey}
          placeholder={resource ? '属性名 または meta.独自名' : '属性名'}
          onChange={(e) => setNewKey(e.target.value)}
        />
      </label>
      <datalist id={optionsId}>
        {supported
          .filter((key) => !fields.some((f) => f.key === key))
          .sort()
          .map((key) => (
            <option key={key} value={key}>
              {names[key] ?? key}
            </option>
          ))}
      </datalist>
      <button
        type="button"
        className="toolbar-button"
        disabled={!newKey.trim()}
        onClick={() => {
          const key = newKey.trim();
          if (
            (!supported.includes(key) && !(resource && /^meta\.[A-Za-z0-9_.:-]+$/.test(key))) ||
            fields.some((f) => f.key === key)
          ) {
            setError('未対応または追加済みの属性です。');
            return;
          }
          const type = numberAttributes.has(key)
            ? 'number'
            : boolAttributes.has(key)
              ? 'boolean'
              : arrayAttributes.has(key) || key === 'signals'
                ? 'array'
                : 'string';
          setFields((current) => [
            ...current,
            { key, type, value: type === 'boolean' ? 'false' : '' },
          ]);
          setNewKey('');
          setError('');
          setSaved(false);
        }}
      >
        属性を追加
      </button>
      <p className="editor-hint">配列は1行に1項目。変更は「変更を反映」で確定します。</p>
      {error && (
        <p className="warning-copy" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="property-saved" role="status">
          変更を反映しました
        </p>
      )}
      <div className="detail-actions">
        <button className="primary-button" type="submit">
          変更を反映
        </button>
        <button className="toolbar-button" type="button" onClick={reset}>
          変更を取り消す
        </button>
      </div>
    </form>
  );
}

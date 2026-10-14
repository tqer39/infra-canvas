import { edgeKinds, edgeKindLabels } from '../core/model';
import { useId, useState } from 'react';
import { getIcon, iconTypes } from '../assets/icons';
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
const fieldsFor = (attrs: Attributes, excludeIcon = false): Field[] =>
  Object.entries(attrs)
    .filter(([key]) => !reserved.has(key) && !(excludeIcon && key === 'icon'))
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
  const [fields, setFields] = useState(() => fieldsFor(item.attributes, !!resource));
  const [label, setLabel] = useState(resource?.label ?? '');
  const [kind, setKind] = useState<Connection['kind']>(connection?.kind ?? 'traffic');
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [icon, setIcon] = useState(String(resource?.attributes.icon ?? ''));
  const [iconQuery, setIconQuery] = useState('');
  const iconGroups: Record<string, string> = {
    aws: 'AWS',
    gcp: 'Google Cloud',
    azure: 'Azure',
    k8s: 'Kubernetes',
    github: 'GitHub',
    gitlab: 'GitLab',
    saas: '外部サービス・SaaS',
    software: 'ソフトウェア',
    external: '利用者・外部リソース',
  };
  const query = iconQuery.trim().toLowerCase();
  const matchingIcons = iconTypes.filter((type) =>
    `${type} ${iconGroups[type.split('.')[0]] ?? 'その他'}`.toLowerCase().includes(query),
  );
  const groups = Object.entries(iconGroups).map(([prefix, name]) => ({
    name,
    types: matchingIcons.filter((type) => type.startsWith(`${prefix}.`)),
  }));
  groups.push({
    name: 'その他',
    types: matchingIcons.filter((type) => !iconGroups[type.split('.')[0]]),
  });
  const [collapsedIconGroups, setCollapsedIconGroups] = useState<string[]>([]);
  const iconButton = (type: string) => (
    <button
      key={type}
      type="button"
      className={`icon-candidate ${type ? '' : 'icon-automatic'}`}
      aria-label={type || '種別から自動選択'}
      aria-pressed={icon === type}
      onClick={() => {
        setIcon(type);
        save({ icon: type });
      }}
    >
      {getIcon(type) ? (
        <img src={getIcon(type)} alt="" />
      ) : (
        <span className="icon-placeholder" aria-hidden="true">
          {type ? '◇' : '自動'}
        </span>
      )}
      <span>
        {type || '種別から自動選択'}
        {type && icon === type && !matchingIcons.includes(type) ? '（現在の選択）' : ''}
      </span>
    </button>
  );
  const supported = resource
    ? [...textAttributes, ...arrayAttributes, ...numberAttributes, ...boolAttributes].filter(
        (key) => !reserved.has(key) && key !== 'icon',
      )
    : ['label', 'protocol', 'port', 'description', 'signals'];
  const change = (key: string, value: string) => {
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, value } : field)),
    );
    setSaved(false);
  };
  const save = (
    next: { fields?: Field[]; label?: string; kind?: Connection['kind']; icon?: string } = {},
  ) => {
    try {
      const attributes: Attributes = Object.fromEntries(
        Object.entries(item.attributes).filter(([key]) => reserved.has(key)),
      );
      for (const field of next.fields ?? fields) {
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
      const nextIcon = next.icon ?? icon;
      if (resource && nextIcon) attributes.icon = nextIcon;
      const nextLabel = next.label ?? label;
      const nextKind = next.kind ?? kind;
      const sameAttributes =
        Object.keys(attributes).length === Object.keys(item.attributes).length &&
        Object.entries(attributes).every(
          ([key, value]) => JSON.stringify(value) === JSON.stringify(item.attributes[key]),
        );
      if (
        sameAttributes &&
        (resource ? nextLabel === resource.label : nextKind === connection!.kind)
      ) {
        setError('');
        setSaved(true);
        return;
      }
      onSave({ label: nextLabel, kind: nextKind, attributes });
      setError('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaved(false);
    }
  };
  return (
    <form
      className="property-editor"
      aria-label={resource ? 'リソース情報の編集' : `接続 ${connection!.id} の編集`}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {resource ? (
        <label>
          名前
          <input
            value={label}
            onBlur={() => save()}
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
              const nextKind = e.target.value as Connection['kind'];
              setKind(nextKind);
              save({ kind: nextKind });
            }}
          >
            {edgeKinds.map((kind) => (
              <option key={kind} value={kind}>
                {edgeKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
      )}
      {resource && (
        <>
          <label>
            表示アイコンを検索
            <input
              type="search"
              value={iconQuery}
              placeholder="例: aws、github、cloud_run"
              onChange={(event) => setIconQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
            />
          </label>
          <fieldset className="icon-picker">
            <legend>表示アイコン</legend>
            <div className="icon-browser">
              {iconButton('')}
              {icon && !matchingIcons.includes(icon) && iconButton(icon)}
              {groups
                .filter((group) => group.types.length)
                .map((group) => (
                  <details
                    className="icon-group"
                    key={group.name}
                    open={!!query || !collapsedIconGroups.includes(group.name)}
                    onToggle={(event) => {
                      if (query) return;
                      const open = event.currentTarget.open;
                      setCollapsedIconGroups((current) =>
                        open
                          ? current.filter((name) => name !== group.name)
                          : [...new Set([...current, group.name])],
                      );
                    }}
                  >
                    <summary>
                      {group.name}
                      <span>{group.types.length} 件</span>
                    </summary>
                    <div className="icon-candidates">{group.types.map(iconButton)}</div>
                  </details>
                ))}
            </div>
          </fieldset>
          <p className="editor-hint" aria-live="polite">
            {matchingIcons.length
              ? `${matchingIcons.length} 件のアイコン`
              : '該当するアイコンはありません'}
          </p>
          {icon && getIcon(icon) && (
            <img className="service-icon" src={getIcon(icon)} alt={`${icon} のプレビュー`} />
          )}
        </>
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
                onBlur={() => save()}
              />
            ) : field.type === 'boolean' || enums[field.key] ? (
              <select
                aria-label={names[field.key] ?? field.key}
                value={field.value}
                onChange={(e) => {
                  change(field.key, e.target.value);
                  save({
                    fields: fields.map((f) =>
                      f.key === field.key ? { ...f, value: e.target.value } : f,
                    ),
                  });
                }}
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
                onBlur={() => save()}
              />
            )}
          </label>
          <button
            type="button"
            className="property-remove"
            aria-label={`${field.key} を削除`}
            onClick={() => {
              const nextFields = fields.filter((f) => f.key !== field.key);
              setFields(nextFields);
              save({ fields: nextFields });
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
          const nextFields: Field[] = [
            ...fields,
            { key, type, value: type === 'boolean' ? 'false' : '' },
          ];
          setFields(nextFields);
          setNewKey('');
          setError('');
          setSaved(false);
          if (type !== 'number') save({ fields: nextFields });
        }}
      >
        属性を追加
      </button>
      <p className="editor-hint">
        配列は1行に1項目。選択は即時、テキストは入力欄を離れると自動反映します。元に戻す操作で取り消せます。
      </p>
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
    </form>
  );
}

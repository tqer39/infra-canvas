import { useEffect, useRef, useState } from 'react';
import { cveDiagram, fetchRecentCves, isCveSnapshot, type CveSnapshot } from '../cve/nvd';
import type { Diagram } from '../core/model';
import { parseDSL } from '../core/parser';
import { cveExamples } from './cve-examples';
import { catalogSnapshot } from '../cve/catalog';

const databaseName = 'infra-canvas-cve';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readSnapshot(): Promise<CveSnapshot | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get('latest');
      request.onsuccess = () => resolve(request.result as CveSnapshot | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function saveSnapshot(snapshot: CveSnapshot): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(snapshot, 'latest');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function CvePanel({
  onApply,
  onClose,
}: {
  onApply: (diagram: Diagram) => boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<CveSnapshot>();
  const refreshed = useRef(false);
  useEffect(() => {
    let active = true;
    void readSnapshot()
      .then((value) => {
        if (active && !refreshed.current) setSnapshot(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const records =
    snapshot?.records.filter((record) =>
      `${record.id} ${(record.aliases ?? []).join(' ')} ${record.description} ${record.products.map((product) => `${product.vendor} ${product.product}`).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const record = snapshot?.records.find((item) => item.id === selected);
  const example = cveExamples.find(
    (item) => item.cveId === selected || record?.aliases?.includes(item.cveId),
  );
  const importSnapshot = async (file: File) => {
    setMessage('');
    try {
      const value: unknown = JSON.parse(await file.text());
      const imported = catalogSnapshot(value) ?? (isCveSnapshot(value) ? value : undefined);
      if (!imported) throw new Error('脆弱性一覧ファイルの形式を確認してください。');
      refreshed.current = true;
      setSnapshot(imported);
      setSelected(undefined);
      try {
        await saveSnapshot(imported);
      } catch {
        setMessage('読み込みましたが、このブラウザーには保存できませんでした。');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '読み込みに失敗しました。');
    }
  };
  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      const next = await fetchRecentCves();
      refreshed.current = true;
      setSnapshot(next);
      setSelected(undefined);
      try {
        await saveSnapshot(next);
      } catch {
        setMessage('取得しましたが、このブラウザーには保存できませんでした。');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CVE を取得できませんでした。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="cve-panel" aria-label="脆弱性情報">
      <div className="panel-title">
        <strong>脆弱性情報</strong>
        <button type="button" onClick={onClose} aria-label="脆弱性情報を閉じる">
          閉じる
        </button>
      </div>
      <p>NVD に直近7日間に公開された CVE を取得します。取得時に NVD へ接続します。</p>
      <button
        type="button"
        className="toolbar-button"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {busy ? '取得中…' : '直近7日間を取得'}
      </button>
      <label className="cve-import">
        保存済み一覧を開く{' '}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importSnapshot(file);
            event.target.value = '';
          }}
        />
      </label>
      {message && <p role="status">{message}</p>}
      {snapshot && (
        <>
          <p>
            対象: {snapshot.start} 〜 {snapshot.end}（
            {snapshot.dateField === 'modified' ? '更新日' : '公開日'}）
            <br />
            {snapshot.origin === 'catalog' ? '書き出し' : '取得'}: {snapshot.fetchedAt}
            <br />
            {snapshot.records.length} 件（このブラウザーに保存）
          </p>
          <label>
            検索{' '}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ID・製品・説明"
            />
          </label>
          <p>
            {records.length} 件に一致{records.length > 100 ? '（先頭100件を表示）' : ''}
          </p>
          <div className="cve-list">
            {records.slice(0, 100).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelected(item.id)}
                aria-pressed={selected === item.id}
              >
                {item.id}
                <span>
                  {item.published.slice(0, 10)} · {item.status}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {record && (
        <section className="cve-detail" aria-label="選択した脆弱性">
          <h3>{record.id}</h3>
          <p>
            公開: {record.published}
            <br />
            更新: {record.modified}
            <br />
            状態: {record.status}
            {record.retrievedAt && (
              <>
                <br />
                取得: {record.retrievedAt}
              </>
            )}
            {record.source && (
              <>
                <br />
                情報源: {record.source}
              </>
            )}
            {!!record.aliases?.length && (
              <>
                <br />
                別名: {record.aliases.join(', ')}
              </>
            )}
          </p>
          <p>{record.description}</p>
          <p>
            対象製品情報: {record.products.length}{' '}
            件。情報がない場合も、影響がないことは意味しません。
          </p>
          <a
            href={
              record.sourceUrl ??
              `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(record.id)}`
            }
            target="_blank"
            rel="noreferrer"
          >
            情報源の原資料
          </a>
          {record.references.map((url, index) => (
            <div key={`${url}-${index}`}>
              <a href={url} target="_blank" rel="noreferrer">
                参照資料 {index + 1}
              </a>
            </div>
          ))}
          <p>
            図は公開情報の整理です。実際の構成、攻撃経路や影響は原資料を確認して補足してください。
          </p>
          {example && (
            <>
              <p>
                この CVE には、一次資料を確認した攻撃経路・影響範囲の事例があります。内容は
                2026年10月31日確認時点です。
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const parsed = parseDSL(example.source);
                  if (parsed.diagram && onApply(parsed.diagram)) onClose();
                }}
              >
                根拠付きの攻撃経路を開く
              </button>
            </>
          )}
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (onApply(cveDiagram(record))) onClose();
            }}
          >
            この情報の図を開く
          </button>
        </section>
      )}
    </aside>
  );
}

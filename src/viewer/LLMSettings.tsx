import { useEffect, useRef, useState } from 'react';
import type { ProviderStatus, RemoteProvider } from '../assistant/remote-contract';

export function LLMSettings({
  provider,
  config,
  available,
  disabled,
  onChange,
  onBusy,
}: {
  provider: RemoteProvider;
  config?: ProviderStatus;
  available: boolean;
  disabled: boolean;
  onChange: (providers: ProviderStatus[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [model, setModel] = useState(config?.model ?? '');
  const [baseURL, setBaseURL] = useState(config?.baseURL ?? '');
  const [apiKey, setAPIKey] = useState('');
  const [profile, setProfile] = useState(config?.profile ?? '');
  const [region, setRegion] = useState(config?.region ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const testController = useRef<AbortController | undefined>(undefined);
  const dirty =
    model.trim() !== (config?.model ?? '') ||
    (provider === 'api'
      ? Boolean(apiKey) || baseURL.trim().replace(/\/$/, '') !== (config?.baseURL ?? '')
      : profile.trim() !== (config?.profile ?? '') || region.trim() !== (config?.region ?? ''));
  useEffect(() => {
    setTestResult('');
  }, [model, baseURL, apiKey, profile, region, config]);
  useEffect(() => () => testController.current?.abort(), []);
  useEffect(() => {
    setModel(config?.model ?? '');
    setBaseURL(config?.baseURL ?? '');
    setProfile(config?.profile ?? '');
    setRegion(config?.region ?? '');
    setAPIKey('');
  }, [config]);
  async function save(reset = false) {
    if (disabled || saving || testing || !available) return;
    setSaving(true);
    onBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          reset
            ? { provider, reset: true }
            : {
                provider,
                model,
                ...(provider === 'api' ? { baseURL, apiKey } : { profile, region }),
              },
        ),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.providers))
        throw new Error(result.error ?? '設定を保存できませんでした。');
      setAPIKey('');
      onChange(result.providers);
      setMessage(
        result.warning ??
          (reset
            ? '起動時の設定に戻しました。'
            : '接続設定を保存しました。認証は生成時に確認します。'),
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }
  async function testConnection() {
    if (disabled || saving || testing || !available || !config?.configured || dirty) return;
    const controller = new AbortController();
    testController.current = controller;
    setTesting(true);
    onBusy(true);
    setTestResult('接続を確認しています…');
    try {
      const response = await fetch('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '接続テストに失敗しました。');
      if (controller.signal.aborted) return;
      setTestResult(
        `接続成功：${result.model}の応答を確認しました（${(result.durationMs / 1000).toFixed(1)}秒）。DSL生成の成功を保証するものではありません。`,
      );
    } catch (error) {
      setTestResult(
        controller.signal.aborted
          ? '接続テストを中止しました。'
          : `接続失敗：${(error as Error).message}`,
      );
    } finally {
      testController.current = undefined;
      setTesting(false);
      onBusy(false);
    }
  }
  const locked = disabled || saving || testing || !available;
  return (
    <section aria-label="LLM接続設定">
      {!available && <p>画面からの設定には、ローカルのpreviewまたは開発サーバーが必要です。</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {provider === 'api' && (
          <>
            <label>
              接続先URL
              <input
                aria-label="API接続先URL"
                type="url"
                value={baseURL}
                disabled={locked}
                onChange={(event) => setBaseURL(event.target.value)}
                placeholder="https://api.example.com/v1"
                required
                maxLength={2048}
              />
            </label>
            <label>
              APIキー
              <input
                aria-label="APIキー"
                type="password"
                autoComplete="off"
                value={apiKey}
                disabled={locked}
                onChange={(event) => setAPIKey(event.target.value)}
                placeholder={config?.hasKey ? '設定済み（空欄なら維持）' : 'APIキーを入力'}
                maxLength={8192}
              />
            </label>
            <p>
              キーは保存後に入力欄から消え、再表示されません。接続先URLを変更する場合はキーも入力してください。
            </p>
          </>
        )}
        <label>
          モデル名
          <input
            aria-label={provider === 'api' ? 'APIモデル名' : 'Bedrockモデル名'}
            value={model}
            disabled={locked}
            onChange={(event) => setModel(event.target.value)}
            placeholder={
              provider === 'api' ? '接続先のモデル名' : 'モデルID・推論プロファイルID/ARN'
            }
            required
            maxLength={512}
          />
        </label>
        {provider === 'bedrock' && (
          <>
            <label>
              AWSプロファイル
              <input
                aria-label="AWSプロファイル"
                value={profile}
                disabled={locked}
                onChange={(event) => setProfile(event.target.value)}
                placeholder="省略すると既定のAWS認証を利用"
                maxLength={128}
              />
            </label>
            <label>
              AWSリージョン
              <input
                aria-label="AWSリージョン"
                value={region}
                disabled={locked}
                onChange={(event) => setRegion(event.target.value)}
                placeholder="ap-northeast-1（省略すると既定の設定）"
                maxLength={64}
              />
            </label>
            <p>
              ローカルで設定済みのAWS認証を使います。SSOのログインは事前に端末で行ってください。
            </p>
          </>
        )}
        <button className="toolbar-button" disabled={locked} type="submit">
          {saving ? '設定中…' : '接続設定を保存'}
        </button>
        {config?.settingsSource === 'persisted' && (
          <button
            className="toolbar-button"
            disabled={locked}
            type="button"
            onClick={() => void save(true)}
          >
            起動時の設定に戻す
          </button>
        )}
      </form>
      <button
        className="toolbar-button"
        type="button"
        disabled={locked || !config?.configured || dirty}
        onClick={() => void testConnection()}
      >
        接続テスト
      </button>
      {testing && (
        <button
          className="toolbar-button"
          type="button"
          onClick={() => testController.current?.abort()}
        >
          接続テストを中止
        </button>
      )}
      <p>
        {dirty
          ? '変更内容を保存してから接続テストしてください。'
          : '保存済みの設定をテストします。短い応答の生成に少量の利用料金が発生する場合があります。会話・DSL・コードは送信しません。'}
      </p>
      {testResult && (
        <p role="status" aria-label="接続テスト結果">
          {testResult}
        </p>
      )}
      <p>
        設定は再起動後も保持され、この端末のサーバーで共有されます。APIキーはOSの資格情報ストアへ保存します。設定時にはLLMを呼び出しません。
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

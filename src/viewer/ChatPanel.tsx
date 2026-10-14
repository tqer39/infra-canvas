import { useEffect, useRef, useState } from 'react';
import { LocalModel, localModels, type GenerationStats } from '../assistant/local-model';
import { retainSourceEvidence } from '../assistant/model-context';
import { RemoteModel } from '../assistant/remote-model';
import type { ProviderStatus, RemoteProvider } from '../assistant/remote-contract';
import { LLMSettings } from './LLMSettings';
import {
  buildMessages,
  parseDraftResponse,
  validateDraft,
  type Draft,
  type ChatMessage,
  type RepositorySnapshot,
} from '../assistant/contract';
import { loadRepository } from '../assistant/repository';
import { parseDSL } from '../core/parser';
import { serializeDSL } from '../core/serialize';
import { repositoryScaffold } from '../assistant/scaffold';
import type { Diagram } from '../core/model';
interface Proposal {
  draft: Draft;
  basedOn: string;
}
export function ChatPanel({
  open,
  source,
  onApply,
  onClose,
}: {
  open: boolean;
  source: string;
  onApply: (diagram: Diagram) => void;
  onClose: () => void;
}) {
  const model = useRef<LocalModel | undefined>(undefined);
  const remoteModel = useRef<RemoteModel | undefined>(undefined);
  const [provider, setProvider] = useState<'local' | RemoteProvider>('local');
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [llmServerAvailable, setLLMServerAvailable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const run = useRef(0),
    currentSource = useRef(source);
  currentSource.current = source;
  const [modelId, setModelId] = useState(localModels[0].id);
  const [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0),
    [status, setStatus] = useState('未読み込み');
  const [error, setError] = useState(''),
    [prompt, setPrompt] = useState('');
  const [failedDSL, setFailedDSL] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [stats, setStats] = useState<GenerationStats>();
  useEffect(() => {
    if (!generating) return;
    const started = performance.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed((performance.now() - started) / 1000), 500);
    return () => clearInterval(timer);
  }, [generating]);
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [proposal, setProposal] = useState<Proposal>();
  const [repository, setRepository] = useState<RepositorySnapshot>();
  const [url, setURL] = useState(''),
    [ref, setRef] = useState(''),
    [root, setRoot] = useState(''),
    [token, setToken] = useState('');
  const [reading, setReading] = useState(false),
    [serverAvailable, setServerAvailable] = useState(false);
  const selectedProvider = providers.find((item) => item.provider === provider);
  const canGenerate =
    provider === 'local' ? ready : !storageError && selectedProvider?.configured === true;
  const readController = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    if (location.protocol === 'http:' || location.protocol === 'https:')
      void fetch('/api/repository/status', { signal: controller.signal })
        .then((response) => response.json())
        .then((value) => setServerAvailable(value.available === true))
        .catch(() => undefined);
    if (location.protocol === 'http:' || location.protocol === 'https:')
      void fetch('/api/llm/status', { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value) => {
          if (Array.isArray(value?.providers)) {
            setProviders(value.providers);
            setLLMServerAvailable(true);
            setStorageError(typeof value.storageError === 'string' ? value.storageError : '');
          }
        })
        .catch(() => undefined);
    return () => {
      controller.abort();
      readController.current?.abort();
      model.current?.interrupt();
      remoteModel.current?.interrupt();
    };
  }, []);
  async function initialize() {
    if (loading || generating) return;
    setError('');
    setLoading(true);
    setReady(false);
    setProgress(0);
    model.current ??= new LocalModel();
    try {
      await model.current.initialize(modelId, (text, value) => {
        setStatus(text);
        setProgress(value);
      });
      setReady(true);
      setStatus('モデル準備完了（端末内で推論）');
    } catch (error) {
      setError((error as Error).message);
      setStatus('モデルの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }
  const cancel = () => {
    run.current++;
    model.current?.interrupt();
    remoteModel.current?.interrupt();
    setGenerating(false);
    setStatus('生成を中止しました。');
  };
  async function generate(request = prompt, fromRepository = false) {
    if (!canGenerate || loading || generating || reading || configuring) return;
    const generator =
      provider === 'local' ? model.current : (remoteModel.current ??= new RemoteModel(provider));
    if (!generator) return;
    const basedOn = source;
    const base = fromRepository
      ? repository
        ? (repositoryScaffold(repository)?.dsl ?? `diagram ${JSON.stringify(repository.name)} {\n}`)
        : 'diagram "Repository" {\n}'
      : proposal?.basedOn === source
        ? proposal.draft.dsl
        : source;
    const requestId = ++run.current;
    setGenerating(true);
    setError('');
    setStats(undefined);
    setStatus(provider === 'local' ? '入力を処理しています…' : '接続先の応答を待っています…');
    setFailedDSL('');
    try {
      const input = buildMessages(base, request, fromRepository ? [] : messages, repository);
      let text = await generator.complete(input.messages, (count, measurement) => {
        if (requestId === run.current) {
          setStatus(`DSLを生成しています… ${count}文字`);
          if (measurement) setStats(measurement);
        }
      });
      if (requestId !== run.current) return;
      let draft: Draft;
      try {
        setFailedDSL(text);
        draft = parseDraftResponse(text);
      } catch (firstError) {
        setStatus('DSLの診断を使って修正しています…');
        text = await generator.complete(
          [
            ...input.messages,
            { role: 'assistant', content: text.slice(0, 16000) },
            {
              role: 'user',
              content: `Return corrected complete JSON and DSL, preserving all directed connections. Only DSL version=1 is supported; never output version=2. Validation errors (data): ${(firstError as Error).message.slice(0, 500)}`,
            },
          ],
          (count, measurement) => {
            if (requestId === run.current) {
              setStatus(`DSLを修正しています… ${count}文字`);
              if (measurement) setStats(measurement);
            }
          },
        );
        if (requestId !== run.current) return;
        setFailedDSL(text);
        draft = parseDraftResponse(text);
      }
      draft.diagram = retainSourceEvidence(draft.diagram, base);
      draft.dsl = serializeDSL(draft.diagram);
      if (fromRepository && repository) {
        draft.diagram.resources = draft.diagram.resources.map((resource) => ({
          ...resource,
          attributes: {
            ...resource.attributes,
            evidence: resource.attributes.evidence === 'unknown' ? 'unknown' : 'inferred',
          },
          provenance: { kind: 'static', repository: repository.url, commit: repository.commit },
        }));
        draft.diagram.connections = draft.diagram.connections.map((connection) => ({
          ...connection,
          attributes: {
            ...connection.attributes,
            evidence: connection.attributes.evidence === 'unknown' ? 'unknown' : 'inferred',
          },
        }));
        draft.dsl = serializeDSL(draft.diagram);
      }
      draft.warnings = [
        ...new Set([...draft.warnings, ...input.warnings, ...(repository?.warnings ?? [])]),
      ];
      setFailedDSL('');
      setProposal({ draft, basedOn });
      setMessages((previous) => [
        ...previous,
        { role: 'user', content: request },
        { role: 'assistant', content: draft.message },
      ]);
      setPrompt('');
      setStatus('生成完了。DSLを確認して図に反映してください。');
    } catch (error) {
      if (requestId === run.current) {
        setError((error as Error).message);
        setStatus('生成結果を反映できませんでした。現在の図は保持しています。');
      }
    } finally {
      if (requestId === run.current) setGenerating(false);
    }
  }
  async function readRepository() {
    if (reading || generating || loading) return;
    const controller = new AbortController();
    readController.current = controller;
    setReading(true);
    setError('');
    setRepository(undefined);
    setProposal(undefined);
    setStatus('リポジトリを読み込んでいます…');
    try {
      let snapshot: RepositorySnapshot;
      if (serverAvailable && !token) {
        const response = await fetch('/api/repository', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, ref, root }),
          signal: controller.signal,
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? 'リポジトリの読み込みに失敗しました。');
        snapshot = value as RepositorySnapshot;
      } else snapshot = await loadRepository(url, ref, root, controller.signal, fetch, token);
      setRepository(snapshot);
      setProposal(undefined);
      setToken('');
      setStatus(`${snapshot.name}: ${snapshot.files.length}ファイルを取得しました。`);
      const infra = snapshot.files.find(
        (file) => file.path.endsWith('.infra') && parseDSL(file.content).diagram,
      );
      if (infra) {
        const draft = validateDraft({
          dsl: infra.content,
          message: `${infra.path} のDSLを読み込みました。`,
          warnings: snapshot.warnings,
        });
        setProposal({ draft, basedOn: source });
      } else {
        const draft = repositoryScaffold(snapshot);
        if (draft) {
          setProposal({ draft, basedOn: source });
          setStatus('宣言からDSLの概要を作成しました。確認して図に反映できます。');
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
      else setStatus('読み込みを中止しました。');
    } finally {
      setReading(false);
    }
  }
  return (
    <aside className="chat-panel" hidden={!open} aria-label="構成図チャット">
      <div className="panel-title">
        <strong>構成図チャット</strong>
        <button onClick={onClose} aria-label="チャットを閉じる">
          ×
        </button>
      </div>
      <p className="chat-privacy">
        {provider === 'local'
          ? 'WebLLMが端末内で生成します。会話とDSLを外部のLLMへ送信しません。'
          : '生成を実行すると、会話・DSL・読み込んだコードの抜粋と解析根拠を選択したLLMへ送信します。認証情報はローカルサーバー側で扱います。'}
      </p>
      <label>
        LLM接続先
        <select
          aria-label="LLM接続先"
          value={provider}
          disabled={loading || generating || reading || configuring}
          onChange={(event) => {
            setProvider(event.target.value as 'local' | RemoteProvider);
            remoteModel.current?.interrupt();
            remoteModel.current = undefined;
            setStats(undefined);
            setError('');
            setStatus(
              event.target.value === 'local'
                ? ready
                  ? 'モデル準備完了（端末内で推論）'
                  : '未読み込み'
                : 'サーバー側の設定を使用します。認証は生成時に確認します。',
            );
          }}
        >
          <option value="local">Qwen（ブラウザー内）</option>
          <option value="api">APIキー（Chat Completions互換）</option>
          <option value="bedrock">Amazon Bedrock（AWS認証）</option>
        </select>
      </label>
      {provider !== 'local' && (
        <div className="chat-hint">
          {storageError && <p role="alert">{storageError}</p>}
          <p>
            {selectedProvider?.configured
              ? `設定済みのモデル：${selectedProvider.model}（認証は生成時に確認）`
              : '接続先が未設定です。下のフォームから設定してください。'}
          </p>
          <details>
            <summary>環境変数で設定する方法</summary>
            <p>
              {provider === 'api'
                ? 'サーバー環境変数 INFRA_LLM_API_BASE_URL・INFRA_LLM_API_MODEL・INFRA_LLM_API_KEY を設定して再起動してください。Chat Completions互換のテキストAPIに対応します。'
                : 'INFRA_LLM_BEDROCK_MODEL にConverse対応のモデルIDまたは推論プロファイルを設定してください。AWS_REGION・AWS_PROFILE、既存のSSO認証やAWS環境変数をサーバー側で使用します。'}
            </p>
            <p>
              APIキーやAWS秘密鍵をチャット本文に入力しないでください。静的HTMLだけではこの接続先を利用できません。
            </p>
          </details>
          {open && (
            <LLMSettings
              key={provider}
              provider={provider}
              config={selectedProvider}
              available={llmServerAvailable}
              disabled={generating || loading || reading}
              onChange={(value) => {
                setProviders(value);
                setStorageError('');
              }}
              onBusy={setConfiguring}
            />
          )}
          <p>
            生成ごとに接続先の料金が発生します。構文エラー時の自動修正は最大1回で、追加の呼び出しになります。
          </p>
        </div>
      )}
      {provider === 'local' && (
        <>
          <label>
            ローカルモデル
            <select
              aria-label="ローカルモデル"
              value={modelId}
              disabled={loading || generating}
              onChange={(event) => {
                setModelId(event.target.value);
                setReady(false);
              }}
            >
              {localModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="chat-hint">
            初回にモデルを取得します（数百MB〜GB規模）。GPUメモリと対応ブラウザーが必要です。再利用時はブラウザーのキャッシュを使います。
          </p>
          <p className="chat-hint">
            速度重視なら1.5Bを選んで読み込んでください。複雑な図では3Bの方が安定します。リポジトリの概要は、モデルを使わずに読み込み時点で作成できます。
          </p>
          {!LocalModel.supported() && (
            <p role="alert">
              このブラウザーではWebGPUを利用できません。WebGPU対応のChrome/Edgeなどで開いてください。
            </p>
          )}
          <button
            className="toolbar-button"
            onClick={() => void initialize()}
            disabled={!LocalModel.supported() || loading || generating || ready}
          >
            {loading ? 'モデルを取得中…' : ready ? 'モデル準備完了' : 'モデルを読み込む'}
          </button>
          {loading && <progress aria-label="モデル読み込み進捗" max={1} value={progress} />}
        </>
      )}
      <details className="repository-input">
        <summary>リポジトリURLから作成</summary>
        <label>
          GitHub URL
          <input
            aria-label="リポジトリURL"
            value={url}
            onChange={(event) => setURL(event.target.value)}
            placeholder="https://github.com/owner/repository"
          />
        </label>
        <label>
          branch / commit（省略可）
          <input
            aria-label="リポジトリ参照"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
          />
        </label>
        <label>
          対象フォルダー（省略可）
          <input
            aria-label="リポジトリ対象フォルダー"
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            placeholder="infra"
          />
        </label>
        {serverAvailable && (
          <p className="chat-hint">ローカルのGitHub CLI認証で非公開リポジトリも読み込めます。</p>
        )}
        <details>
          <summary>GitHub読み取り用トークン（任意）</summary>
          <input
            type="password"
            autoComplete="off"
            aria-label="GitHub読み取り用トークン"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <p className="chat-hint">
            GitHubへの取得時だけ使用します。保存やLLMへの送信は行いません。
          </p>
        </details>
        <button
          className="toolbar-button"
          disabled={!url.trim() || reading || generating || loading}
          onClick={() => void readRepository()}
        >
          {reading ? '読み込み中…' : 'リポジトリを読み込む'}
        </button>
        {reading && (
          <button className="toolbar-button" onClick={() => readController.current?.abort()}>
            読み込みを中止
          </button>
        )}
        {repository && (
          <div className="repository-result">
            <strong>{repository.name}</strong>
            <small>commit {repository.commit.slice(0, 12)}</small>
            <ul>
              {repository.files.map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            {repository.analysis && (
              <details className="analysis-evidence">
                <summary>
                  解析の根拠：{repository.analysis.dependencies.length} 参照・
                  {repository.analysis.calls.length} 呼び出し・
                  {repository.analysis.relations.length} 関係・
                  {(repository.analysis.flows ?? []).length} 引数伝播
                </summary>
                {repository.analysis.relations.map((relation, index) => (
                  <div key={index}>
                    <strong>
                      {relation.source} → {relation.target}（{relation.kind}）
                    </strong>
                    <ul>
                      {relation.evidence.map((item, n) => (
                        <li key={n}>
                          {item.file}:{item.line} — {item.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {(repository.analysis.flows ?? []).length > 0 && (
                  <details>
                    <summary>引数の伝播（値は表示しません）</summary>
                    <ul>
                      {repository.analysis.flows.slice(0, 40).map((flow, index) => (
                        <li key={index}>
                          {flow.from.file}:{flow.from.line} → {flow.to.file}:{flow.to.line}（
                          {flow.resolved}/{flow.arguments} 引数を解決）
                        </li>
                      ))}
                    </ul>
                    {repository.analysis.flows.length > 40 && <p>先頭40件を表示しています。</p>}
                  </details>
                )}
                {repository.analysis.diagnostics.map((message, index) => (
                  <p key={index}>{message}</p>
                ))}
              </details>
            )}
            {repository.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
            <button
              className="toolbar-button"
              disabled={!canGenerate || generating || reading || loading || configuring}
              onClick={() =>
                void generate(
                  'このリポジトリの主要サービスの構成図を新しく作成してください。DSLのバージョンは必ず version=1 にしてください。境界を含めリソースは20件を目安に集約してください。現在のDSLの全接続と静的解析根拠で確認できる関係を省略せず、向き・意味・実行条件を保持した矢印として含めてください。接続数が20件を超えても省略しないでください。DNSレコードや個別権限の細部は列挙せず集約し、集約後も接続関係を保持してください。ソースで確認できる関係だけを表し、実環境での通信成立とは断定しないでください。未確認の情報は短い注意点を最大3点記載してください。説明は80文字以内、DSLは短く、必ず最後の閉じ括弧まで完成させてください。',
                  true,
                )
              }
            >
              LLMで概要を補足
            </button>
            <button className="toolbar-button" onClick={() => setRepository(undefined)}>
              読込みを解除
            </button>
          </div>
        )}
      </details>
      <div className="chat-messages" role="log" aria-label="チャット履歴">
        {messages.map((message, index) => (
          <div key={index} className={`chat-message ${message.role}`}>
            <strong>{message.role === 'user' ? 'あなた' : 'LLM'}</strong>
            <p>{message.content}</p>
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <textarea
          aria-label="チャットの依頼"
          value={prompt}
          maxLength={3000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例：VPC内のPrivate SubnetにEC2を置き、Web SGからTCP 8080を許可してください。"
        />
        <button
          className="toolbar-button"
          disabled={
            !canGenerate || !prompt.trim() || generating || reading || loading || configuring
          }
          type="submit"
        >
          DSLを生成
        </button>
        {generating && (
          <button className="toolbar-button" type="button" onClick={cancel}>
            生成を中止
          </button>
        )}
      </form>
      <p className="chat-status" role="status">
        {status}
        {generating && `（${Math.floor(elapsed)}秒経過）`}
      </p>
      {stats && (
        <p className="chat-hint" aria-label="生成速度">
          直近の生成：入力{stats.inputTokens}・出力{stats.outputTokens}トークン
          {stats.firstTokenSeconds !== undefined &&
            `／最初の出力まで${stats.firstTokenSeconds.toFixed(1)}秒`}
          {stats.tokensPerSecond !== undefined &&
            `／${stats.tokensPerSecond.toFixed(1)}トークン/秒`}
        </p>
      )}
      {error && (
        <pre className="chat-error" role="alert">
          {error}
        </pre>
      )}
      {error && failedDSL && (
        <details className="draft-preview">
          <summary>生成されたDSL（未検証）</summary>
          <textarea aria-label="未検証のDSL" readOnly value={failedDSL} />
        </details>
      )}
      {proposal && (
        <section className="draft-preview" aria-label="生成したDSL">
          <strong>DSLの提案</strong>
          <p>{proposal.draft.message}</p>
          <p>
            {proposal.draft.diagram.resources.length}リソース・
            {proposal.draft.diagram.connections.length}接続
          </p>
          {proposal.draft.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
          <textarea aria-label="生成したDSLの内容" readOnly value={proposal.draft.dsl} />
          {proposal.basedOn !== source && (
            <p role="alert">生成後に現在のDSLが変更されました。再生成してください。</p>
          )}
          <button
            className="toolbar-button"
            disabled={generating || proposal.basedOn !== source}
            onClick={() => {
              if (currentSource.current !== proposal.basedOn) return;
              onApply(proposal.draft.diagram);
              setProposal(undefined);
              setStatus('図に反映しました。');
            }}
          >
            図に反映
          </button>
          <button className="toolbar-button" onClick={() => setProposal(undefined)}>
            提案を破棄
          </button>
        </section>
      )}
    </aside>
  );
}

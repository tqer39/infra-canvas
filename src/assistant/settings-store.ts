import { mkdir, lstat, readFile, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Configuration } from './llm-server.js';
import type { RemoteProvider } from './remote-contract.js';

export type Settings = Partial<Record<RemoteProvider, Configuration>>;
export interface SettingsStore {
  load(): Promise<Settings>;
  save(provider: RemoteProvider, config: Configuration): Promise<string | undefined>;
  reset(provider: RemoteProvider): Promise<string | undefined>;
}
export interface SecretStore {
  get(id: string): Promise<string | null>;
  set(id: string, secret: string): Promise<void>;
  remove(id: string): Promise<void>;
}
export const osSecrets: SecretStore = {
  async get(id) {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    return new AsyncEntry('infra-canvas.llm', id, {
      linux: { store: 'secret-service' },
    }).getPassword();
  },
  async set(id, secret) {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    await new AsyncEntry('infra-canvas.llm', id, {
      linux: { store: 'secret-service' },
    }).setPassword(secret);
  },
  async remove(id) {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    await new AsyncEntry('infra-canvas.llm', id, {
      linux: { store: 'secret-service' },
    }).deleteCredential();
  },
};
export function settingsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  if (env.INFRA_LLM_CONFIG_DIR) return resolve(env.INFRA_LLM_CONFIG_DIR);
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Infra Canvas');
  if (platform === 'win32')
    return join(
      env.LOCALAPPDATA || env.APPDATA || join(homedir(), 'AppData', 'Local'),
      'Infra Canvas',
    );
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'infra-canvas');
}
type StoredConfiguration = Omit<Configuration, 'apiKey'> & { keyId?: string };
type StoredSettings = Partial<Record<RemoteProvider, StoredConfiguration>>;
const failure = () =>
  new Error(
    '接続設定またはOSの資格情報ストアを利用できません。ロック・権限・設定ファイルを確認してください。APIキーの平文保存は行いません。',
  );

export class PersistentSettings implements SettingsStore {
  readonly path: string;
  constructor(
    private directory = settingsDirectory(),
    private secrets: SecretStore = osSecrets,
  ) {
    this.path = join(directory, 'llm-settings.json');
  }
  private async check(path: string, directory: boolean) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
      throw failure();
    if (
      process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    )
      throw failure();
    return stat;
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.check(this.directory, true);
    const lockPath = join(this.directory, '.llm-settings.lock');
    let lock;
    const deadline = Date.now() + 5000;
    while (!lock) {
      try {
        lock = await open(lockPath, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline)
          throw failure();
        try {
          const stat = await this.check(lockPath, false);
          if (stat.size <= 20) {
            const pid = Number(await readFile(lockPath, 'utf8'));
            if (Number.isInteger(pid) && pid > 0) {
              try {
                process.kill(pid, 0);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lockPath);
              }
            }
          }
        } catch {
          /* Another writer can release its lock while it is inspected. */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      await lock.writeFile(String(process.pid));
      return await operation();
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
  private async read(): Promise<StoredSettings> {
    try {
      await this.check(this.directory, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw failure();
    }
    try {
      const stat = await this.check(this.path, false);
      if (stat.size > 16000) throw failure();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw failure();
    }
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        !value ||
        value.version !== 1 ||
        !value.providers ||
        typeof value.providers !== 'object' ||
        Object.keys(value).some((key) => !['version', 'providers'].includes(key))
      )
        throw failure();
      for (const [provider, config] of Object.entries(value.providers)) {
        if (!['api', 'bedrock'].includes(provider) || !config || typeof config !== 'object')
          throw failure();
        const item = config as Record<string, unknown>;
        const allowed =
          provider === 'api'
            ? ['model', 'maxTokens', 'baseURL', 'jsonMode', 'keyId']
            : ['model', 'maxTokens', 'profile', 'region'];
        if (
          Object.keys(item).some((key) => !allowed.includes(key)) ||
          typeof item.model !== 'string' ||
          !item.model ||
          item.model.length > 512 ||
          !Number.isInteger(item.maxTokens) ||
          Number(item.maxTokens) < 256 ||
          Number(item.maxTokens) > 16384
        )
          throw failure();
        if (provider === 'api') {
          if (
            typeof item.baseURL !== 'string' ||
            typeof item.jsonMode !== 'boolean' ||
            typeof item.keyId !== 'string' ||
            !/^[0-9a-f-]{36}$/.test(item.keyId)
          )
            throw failure();
          const url = new URL(item.baseURL);
          if (
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !(
              url.protocol === 'https:' ||
              (url.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
            )
          )
            throw failure();
        } else if (
          ['profile', 'region'].some(
            (key) =>
              item[key] !== undefined &&
              (typeof item[key] !== 'string' || String(item[key]).length > 128),
          )
        )
          throw failure();
      }
      return value.providers as StoredSettings;
    } catch {
      throw failure();
    }
  }
  async load(): Promise<Settings> {
    const stored = await this.read();
    const settings: Settings = {};
    if (stored.bedrock) settings.bedrock = { ...stored.bedrock };
    if (stored.api) {
      try {
        const secret = await this.secrets.get(stored.api.keyId!);
        if (!secret) throw failure();
        const { keyId: _keyId, ...config } = stored.api;
        settings.api = { ...config, apiKey: secret };
      } catch {
        throw failure();
      }
    }
    return settings;
  }
  private async write(stored: StoredSettings) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.check(this.directory, true);
    const temporary = join(this.directory, `.llm-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: 1, providers: stored }, null, 2));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  private async cleanup(id?: string): Promise<string | undefined> {
    if (!id) return;
    try {
      await this.secrets.remove(id);
    } catch {
      return '設定は更新されましたが、古いAPIキーを資格情報ストアから削除できませんでした。資格情報ストアのロック・権限を確認してください。';
    }
  }
  async save(provider: RemoteProvider, config: Configuration): Promise<string | undefined> {
    return this.exclusive(() => this.saveLocked(provider, config));
  }
  private async saveLocked(
    provider: RemoteProvider,
    config: Configuration,
  ): Promise<string | undefined> {
    const stored = await this.read();
    const oldId = provider === 'api' ? stored.api?.keyId : undefined;
    let newId: string | undefined;
    try {
      if (provider === 'api') {
        if (!config.apiKey) throw failure();
        newId = randomUUID();
        await this.secrets.set(newId, config.apiKey);
        // Explicit allowlist: never serialize credentials or arbitrary fields.
        stored.api = {
          model: config.model,
          maxTokens: config.maxTokens,
          baseURL: config.baseURL,
          jsonMode: config.jsonMode ?? true,
          keyId: newId,
        };
      } else
        stored.bedrock = {
          model: config.model,
          maxTokens: config.maxTokens,
          profile: config.profile,
          region: config.region,
        };
      await this.write(stored);
    } catch {
      if (newId) await this.cleanup(newId);
      throw failure();
    }
    return this.cleanup(oldId);
  }
  async reset(provider: RemoteProvider): Promise<string | undefined> {
    return this.exclusive(() => this.resetLocked(provider));
  }
  private async resetLocked(provider: RemoteProvider): Promise<string | undefined> {
    const stored = await this.read(),
      oldId = provider === 'api' ? stored.api?.keyId : undefined;
    delete stored[provider];
    try {
      await this.write(stored);
    } catch {
      throw failure();
    }
    return this.cleanup(oldId);
  }
}

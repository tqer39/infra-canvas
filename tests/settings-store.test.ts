import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentSettings, type SecretStore } from '../src/assistant/settings-store.js';

const api = {
  model: 'example',
  baseURL: 'https://api.example.test/v1',
  apiKey: 'secret-not-on-disk',
  maxTokens: 4096,
  jsonMode: true,
};
const bedrock = {
  model: 'aws-model',
  profile: 'diagram',
  region: 'ap-northeast-1',
  maxTokens: 4096,
};
function fakeSecrets() {
  const secrets = new Map<string, string>();
  const adapter: SecretStore = {
    get: async (id) => secrets.get(id) ?? null,
    set: async (id, secret) => {
      secrets.set(id, secret);
    },
    remove: async (id) => {
      secrets.delete(id);
    },
  };
  return { secrets, adapter };
}
it('再起動したストアでAPI・AWS設定を復元し、ディスクにキーを保存せず制限した権限で保存する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'infra-settings-'));
  const { adapter, secrets } = fakeSecrets();
  try {
    const store = new PersistentSettings(directory, adapter);
    await store.save('api', api);
    await store.save('bedrock', bedrock);
    assert.deepEqual(await new PersistentSettings(directory, adapter).load(), { api, bedrock });
    assert.doesNotMatch(await readFile(store.path, 'utf8'), /secret-not-on-disk|apiKey/);
    assert.equal(secrets.size, 1);
    if (process.platform !== 'win32') assert.equal((await stat(store.path)).mode & 0o777, 0o600);
    await store.save('api', { ...api, apiKey: 'replacement-secret' });
    assert.equal(secrets.size, 1);
    assert.equal(
      (await new PersistentSettings(directory, adapter).load()).api?.apiKey,
      'replacement-secret',
    );
    await store.reset('api');
    assert.equal(secrets.size, 0);
    assert.deepEqual(await store.load(), { bedrock });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('資格情報ストアが利用できないと保存を拒否し、以前の設定やキーを壊さない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'infra-settings-'));
  const { adapter } = fakeSecrets();
  try {
    const store = new PersistentSettings(directory, adapter);
    await store.save('api', api);
    const before = await readFile(store.path, 'utf8');
    const unavailable: SecretStore = {
      ...adapter,
      set: async () => {
        throw new Error('RAW secret error');
      },
    };
    await assert.rejects(
      new PersistentSettings(directory, unavailable).save('api', { ...api, apiKey: 'new' }),
      /平文保存は行いません/,
    );
    assert.equal(await readFile(store.path, 'utf8'), before);
    assert.equal((await store.load()).api?.apiKey, api.apiKey);
    const locked: SecretStore = {
      ...adapter,
      get: async () => {
        throw new Error('RAW key error');
      },
    };
    await assert.rejects(new PersistentSettings(directory, locked).load(), /資格情報ストア/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('同時保存で別プロバイダーを消さず、破損した設定を上書きしない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'infra-settings-'));
  const { adapter } = fakeSecrets();
  try {
    const first = new PersistentSettings(directory, adapter),
      second = new PersistentSettings(directory, adapter);
    await Promise.all([first.save('api', api), second.save('bedrock', bedrock)]);
    assert.deepEqual(await first.load(), { api, bedrock });
    await writeFile(first.path, 'invalid json');
    await assert.rejects(second.save('bedrock', bedrock), /設定/);
    assert.equal(await readFile(first.path, 'utf8'), 'invalid json');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

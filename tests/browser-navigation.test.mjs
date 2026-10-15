import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { navigateWithNetworkRecovery } from './browser/navigation.ts';

test('初期ロード中のネットワーク変更だけを一度復旧し、リスナーを残さない', async () => {
  const page = new EventEmitter();
  let calls = 0;
  const navigate = async () => {
    if (++calls === 1)
      page.emit('requestfailed', { failure: () => ({ errorText: 'net::ERR_NETWORK_CHANGED' }) });
    return null;
  };
  assert.equal(await navigateWithNetworkRecovery(page, navigate, 'http://127.0.0.1:5188'), null);
  assert.equal(calls, 2);
  assert.equal(page.listenerCount('requestfailed'), 0);
});

test('同じネットワーク変更の再発を失敗にし、一般の読み込みエラーは再試行しない', async () => {
  for (const networkChange of [true, false]) {
    const page = new EventEmitter();
    let calls = 0;
    const navigate = async () => {
      calls++;
      if (networkChange)
        page.emit('requestfailed', { failure: () => ({ errorText: 'net::ERR_NETWORK_CHANGED' }) });
      throw new Error('load failed');
    };
    await assert.rejects(
      navigateWithNetworkRecovery(page, navigate, 'http://127.0.0.1:5188'),
      /load failed/,
    );
    assert.equal(calls, networkChange ? 2 : 1);
    assert.equal(page.listenerCount('requestfailed'), 0);
  }
});

test('HTTP文書が読み込めても依存資源のネットワーク変更が再発したら失敗させる', async () => {
  const page = new EventEmitter();
  let calls = 0;
  const navigate = async () => {
    calls++;
    page.emit('requestfailed', { failure: () => ({ errorText: 'net::ERR_NETWORK_CHANGED' }) });
    return null;
  };
  await assert.rejects(
    navigateWithNetworkRecovery(page, navigate, 'http://127.0.0.1:5188'),
    /再発/,
  );
  assert.equal(calls, 2);
  assert.equal(page.listenerCount('requestfailed'), 0);
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SmartThingsClient } from '../dist/smartthings.js';

test('rotates OAuth tokens, persists them privately, and retries after a 401', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'samsung-window-ac-'));
  const tokenPath = join(directory, 'tokens.json');
  const config = {
    authMode: 'oauth', clientId: 'client', clientSecret: 'secret', refreshToken: 'initial',
    requestTimeout: 2, deviceId: 'device',
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  let refreshCount = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth/token')) {
      refreshCount += 1;
      return new globalThis.Response(JSON.stringify({
        access_token: `access-${refreshCount}`,
        refresh_token: `refresh-${refreshCount}`,
        expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (calls.filter(call => call.url.endsWith('/status')).length === 2) {
      return new globalThis.Response('', { status: 401 });
    }
    return new globalThis.Response(JSON.stringify({ components: { main: {} } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const client = new SmartThingsClient(config, tokenPath);
    await client.initialize();
    await client.status('device');
    assert.equal(refreshCount, 1);
    assert.equal((await readFile(tokenPath, 'utf8')).includes('refresh-1'), true);
    assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);

    const restarted = new SmartThingsClient(config, tokenPath);
    await restarted.initialize();
    await restarted.status('device');
    assert.equal(refreshCount, 2);
    assert.equal((await readFile(tokenPath, 'utf8')).includes('refresh-2'), true);
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer access-2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renews credentials while the AC is unreachable and survives a restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'samsung-window-ac-offline-'));
  const tokenPath = join(directory, 'tokens.json');
  const config = {
    authMode: 'oauth', clientId: 'client', clientSecret: 'secret', refreshToken: 'initial',
    requestTimeout: 2, deviceId: 'device',
  };
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let clock = originalNow();
  let refreshCount = 0;
  let statusCount = 0;
  Date.now = () => clock;
  globalThis.fetch = async url => {
    if (url.endsWith('/oauth/token')) {
      refreshCount += 1;
      return new globalThis.Response(JSON.stringify({
        access_token: `access-${refreshCount}`,
        refresh_token: `refresh-${refreshCount}`,
        expires_in: 86400,
      }), { status: 200 });
    }
    statusCount += 1;
    return new globalThis.Response('', { status: 503 });
  };
  try {
    const client = new SmartThingsClient(config, tokenPath);
    await client.initialize();
    await assert.rejects(client.status('device'), /HTTP 503/);
    assert.equal(refreshCount, 1);
    clock += 25 * 60 * 60 * 1000;
    await client.maintainTokens();
    assert.equal(refreshCount, 2);
    assert.equal(statusCount, 1);

    const restarted = new SmartThingsClient(config, tokenPath);
    await restarted.initialize();
    clock += 25 * 60 * 60 * 1000;
    await restarted.maintainTokens();
    assert.equal(refreshCount, 3);
    assert.equal((await readFile(tokenPath, 'utf8')).includes('refresh-3'), true);
    assert.equal(statusCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

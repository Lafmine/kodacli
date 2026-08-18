import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {loadConfig} from '../src/config.js';

const cleanup: string[] = [];
const originalKey = process.env.KODA_API_KEY;
const originalProvider = process.env.KODA_PROVIDER;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.KODA_API_KEY;
  else process.env.KODA_API_KEY = originalKey;
  if (originalProvider === undefined) delete process.env.KODA_PROVIDER;
  else process.env.KODA_PROVIDER = originalProvider;
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe('provider configuration', () => {
  it('selects GenAPI when KODA_API_KEY is available', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-config-'));
    cleanup.push(workspace);
    process.env.KODA_API_KEY = 'test-key';
    delete process.env.KODA_PROVIDER;
    await expect(loadConfig(workspace)).resolves.toMatchObject({
      provider: 'genapi', model: 'gpt-4.1-nano', baseUrl: 'https://proxy.gen-api.ru/v1',
    });
  });

  it('allows explicit offline demo mode', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-config-'));
    cleanup.push(workspace);
    process.env.KODA_PROVIDER = 'demo';
    await expect(loadConfig(workspace)).resolves.toMatchObject({provider: 'demo', model: 'demo-v1'});
  });
});

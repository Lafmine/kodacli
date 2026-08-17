import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {loadWorkspaceEnvironment} from '../src/environment.js';

const cleanup: string[] = [];
const originalValue = process.env.KODA_ENV_LOADER_TEST;

afterEach(async () => {
  if (originalValue === undefined) delete process.env.KODA_ENV_LOADER_TEST;
  else process.env.KODA_ENV_LOADER_TEST = originalValue;
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe('workspace environment', () => {
  it('loads variables from a workspace .env', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-env-'));
    cleanup.push(workspace);
    delete process.env.KODA_ENV_LOADER_TEST;
    await writeFile(path.join(workspace, '.env'), 'KODA_ENV_LOADER_TEST=loaded\n');
    loadWorkspaceEnvironment(workspace);
    expect(process.env.KODA_ENV_LOADER_TEST).toBe('loaded');
  });

  it('allows workspaces without an .env file', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-env-'));
    cleanup.push(workspace);
    expect(() => loadWorkspaceEnvironment(workspace)).not.toThrow();
  });
});

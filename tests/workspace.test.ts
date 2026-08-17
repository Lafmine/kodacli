import {mkdtemp, mkdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {resolveWorkspacePath, truncateOutput} from '../src/tools/workspace.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe('workspace path guard', () => {
  it('accepts existing and new paths inside the workspace', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-workspace-'));
    cleanup.push(workspace);
    await mkdir(path.join(workspace, 'src'));
    await writeFile(path.join(workspace, 'src', 'index.ts'), 'ok');
    expect(await resolveWorkspacePath(workspace, 'src/index.ts')).toBe(await realpath(path.join(workspace, 'src', 'index.ts')));
    expect(await resolveWorkspacePath(workspace, 'src/new.ts', true)).toBe(path.join(await realpath(workspace), 'src', 'new.ts'));
  });

  it('blocks traversal outside the workspace', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-workspace-'));
    cleanup.push(workspace);
    await expect(resolveWorkspacePath(workspace, '../secret.txt', true)).rejects.toThrow(/outside the workspace/i);
  });

  it('marks truncated output', () => {
    expect(truncateOutput('123456', 4)).toEqual({output: '1234\n… output truncated', truncated: true});
  });
});

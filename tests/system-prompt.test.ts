import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {buildSystemPrompt, loadPrivateSystemPrompt} from '../src/system-prompt.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((directory) => rm(directory, {recursive: true, force: true}))));

describe('private system prompt', () => {
  it('loads an opaque local prompt without publishing it', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-prompt-'));
    cleanup.push(workspace);
    await writeFile(path.join(workspace, 'sysprm.txt'), 'private test instruction');
    await expect(loadPrivateSystemPrompt(workspace)).resolves.toBe('private test instruction');
  });

  it('is optional', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-prompt-'));
    cleanup.push(workspace);
    await expect(loadPrivateSystemPrompt(workspace)).resolves.toBeUndefined();
  });

  it('keeps core tool guidance when a private prompt exists', () => {
    const prompt = buildSystemPrompt('private test instruction');
    expect(prompt).toContain('open_file');
    expect(prompt).toContain('private test instruction');
  });
});

import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {appendMessage, createSession, SessionStore} from '../src/sessions.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((directory) => rm(directory, {recursive: true, force: true}))));

describe('SessionStore', () => {
  it('saves and restores a session', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'koda-session-'));
    cleanup.push(directory);
    const store = new SessionStore(directory);
    const session = appendMessage(createSession('C:/project', 'demo', 'demo-v1'), {role: 'user', content: 'hello'});
    await store.save(session);
    expect((await store.load(session.id))?.messages[0]?.content).toBe('hello');
  });

  it('ignores corrupt session data', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'koda-session-'));
    cleanup.push(directory);
    const store = new SessionStore(directory);
    await mkdir(store.directory, {recursive: true});
    await writeFile(path.join(store.directory, 'broken.json'), '{nope');
    expect(await store.load('broken')).toBeUndefined();
    expect(await store.latest()).toBeUndefined();
  });
});

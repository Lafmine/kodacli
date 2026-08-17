import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {runAgent} from '../src/core/agent.js';
import type {AgentEvent, ChatMessage} from '../src/core/types.js';
import {DemoProvider} from '../src/providers/demo.js';
import {builtInTools} from '../src/tools/index.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((directory) => rm(directory, {recursive: true, force: true}))));

async function collect(messages: ChatMessage[], workspace: string, mode: 'plan' | 'bypass'): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    provider: new DemoProvider(), messages, tools: builtInTools,
    context: {workspace, commandTimeoutMs: 1000, maxOutputChars: 1000},
    model: 'demo-v1', permissionMode: mode, authorize: async () => true,
    signal: new AbortController().signal,
  })) events.push(event);
  return events;
}

describe('agent loop', () => {
  it('executes an allowed demo tool and returns its result', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-agent-'));
    cleanup.push(workspace);
    const messages: ChatMessage[] = [{role: 'user', content: 'demo write note.txt :: hello'}];
    const events = await collect(messages, workspace, 'bypass');
    expect(await readFile(path.join(workspace, 'note.txt'), 'utf8')).toBe('hello');
    expect(events.some((event) => event.type === 'tool_result' && event.result?.ok)).toBe(true);
    expect(messages.some((message) => message.role === 'tool')).toBe(true);
  });

  it('blocks writes in plan mode', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'koda-agent-'));
    cleanup.push(workspace);
    const events = await collect([{role: 'user', content: 'demo write blocked.txt :: no'}], workspace, 'plan');
    expect(events.some((event) => event.type === 'tool_result' && event.result?.output.includes('plan mode'))).toBe(true);
    await expect(readFile(path.join(workspace, 'blocked.txt'))).rejects.toThrow();
  });
});

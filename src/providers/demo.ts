import {randomUUID} from 'node:crypto';
import type {ChatProvider, ChatRequest, ProviderEvent} from '../core/types.js';

const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new Error('Request aborted.'));
  }, {once: true});
});

function parseDemoTool(prompt: string): {name: string; input: unknown} | undefined {
  const trimmed = prompt.trim();
  let match = /^demo\s+read\s+(.+)$/i.exec(trimmed);
  if (match?.[1]) return {name: 'read_file', input: {path: match[1].trim()}};
  match = /^demo\s+list(?:\s+(.+))?$/i.exec(trimmed);
  if (match) return {name: 'list_files', input: {path: match[1]?.trim() ?? '.'}};
  match = /^demo\s+search\s+(.+)$/i.exec(trimmed);
  if (match?.[1]) return {name: 'search', input: {pattern: match[1].trim()}};
  match = /^demo\s+shell\s+(.+)$/i.exec(trimmed);
  if (match?.[1]) return {name: 'shell', input: {command: match[1].trim()}};
  match = /^demo\s+write\s+(.+?)\s+::\s*([\s\S]*)$/i.exec(trimmed);
  if (match?.[1] !== undefined && match[2] !== undefined) return {name: 'write_file', input: {path: match[1].trim(), content: match[2]}};
  return undefined;
}

export class DemoProvider implements ChatProvider {
  readonly name = 'demo';

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const last = request.messages.at(-1);
    if (!last) {
      yield {type: 'done'};
      return;
    }

    if (last.role === 'tool') {
      const summary = last.content.length > 300 ? `${last.content.slice(0, 300)}…` : last.content;
      yield {type: 'text', text: `Tool result (${last.toolName ?? 'unknown'}):\n${summary}`};
      yield {type: 'usage', inputTokens: 0, outputTokens: 0};
      yield {type: 'done'};
      return;
    }

    const toolCall = parseDemoTool(last.content);
    if (toolCall) {
      yield {type: 'text', text: `Preparing ${toolCall.name}…\n`};
      yield {type: 'tool_call', id: randomUUID(), ...toolCall};
      return;
    }

    const parts = [
      'Koda is running in local demo mode. ',
      'No AI provider is connected yet.\n\n',
      'Try `demo list`, `demo read README.md`, `demo search Koda`, ',
      '`demo shell git status`, or `demo write notes.txt :: hello`.',
    ];
    for (const text of parts) {
      if (signal.aborted) throw new Error('Request aborted.');
      await wait(35, signal);
      yield {type: 'text', text};
    }
    yield {type: 'usage', inputTokens: 0, outputTokens: 0};
    yield {type: 'done'};
  }
}

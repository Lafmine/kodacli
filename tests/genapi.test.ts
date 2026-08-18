import {createServer, type RequestListener, type Server} from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {GenApiProvider} from '../src/providers/genapi.js';
import type {ChatRequest, ProviderEvent} from '../src/core/types.js';

const servers: Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

async function startServer(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address.');
  return `http://127.0.0.1:${address.port}/v1`;
}

const request: ChatRequest = {
  messages: [{role: 'user', content: 'List files'}],
  workspace: 'C:/project',
  model: 'gpt-4.1-nano',
  tools: [{name: 'list_files', description: 'List files', inputSchema: {type: 'object', properties: {path: {type: 'string'}}}}],
};

describe('GenApiProvider', () => {
  it('streams text and reconstructs tool calls from OpenAI-compatible SSE', async () => {
    let receivedAuthorization = '';
    let receivedBody = '';
    const baseUrl = await startServer((incoming, response) => {
      receivedAuthorization = incoming.headers.authorization ?? '';
      incoming.on('data', (chunk: Buffer) => { receivedBody += chunk.toString(); });
      incoming.on('end', () => {
        response.writeHead(200, {'content-type': 'text/event-stream'});
        response.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"content":"there","tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_","arguments":"{\\"path\\":"}}]}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"files","arguments":"\\".\\"}"}}]}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n');
        response.end('data: [DONE]\n\n');
      });
    });
    const provider = new GenApiProvider({apiKey: 'test-key', baseUrl});
    const events: ProviderEvent[] = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);

    expect(receivedAuthorization).toBe('Bearer test-key');
    expect(JSON.parse(receivedBody)).toMatchObject({model: 'gpt-4.1-nano', stream: true, tool_choice: 'auto'});
    expect(events.filter((event) => event.type === 'text').map((event) => event.type === 'text' ? event.text : '').join('')).toBe('Hello there');
    expect(events).toContainEqual({type: 'tool_call', id: 'call_1', name: 'list_files', input: {path: '.'}});
    expect(events).toContainEqual({type: 'usage', inputTokens: 4, outputTokens: 2});
    expect(events.at(-1)).toEqual({type: 'done'});
  });

  it('redacts the API key from HTTP errors', async () => {
    const baseUrl = await startServer((_incoming, response) => {
      response.writeHead(401, {'content-type': 'text/plain'});
      response.end('invalid secret-value');
    });
    const provider = new GenApiProvider({apiKey: 'secret-value', baseUrl});
    const consume = async () => {
      for await (const _event of provider.stream(request, new AbortController().signal)) { /* consume */ }
    };
    await expect(consume()).rejects.toThrow('invalid [redacted]');
  });
});

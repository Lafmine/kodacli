import type {ChatMessage, ChatProvider, ChatRequest, ProviderEvent} from '../core/types.js';

interface GenApiProviderOptions {
  apiKey: string;
  baseUrl?: string | undefined;
}

interface StreamToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {name?: string; arguments?: string};
      }>;
    };
  }>;
  usage?: {prompt_tokens?: number; completion_tokens?: number};
  error?: {message?: string};
}

function mapMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {role: 'tool', content: message.content, tool_call_id: message.toolCallId};
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {name: call.name, arguments: JSON.stringify(call.input)},
      })),
    };
  }
  return {role: message.role, content: message.content};
}

function parseToolInput(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

export class GenApiProvider implements ChatProvider {
  readonly name = 'genapi';
  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor(options: GenApiProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? 'https://proxy.gen-api.ru/v1').replace(/\/$/, '');
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        stream_options: {include_usage: true},
        messages: [
          {role: 'system', content: request.systemPrompt ?? 'You are Koda Code, a concise terminal coding agent. Inspect the workspace with tools before making claims. Use tools to read, create, and edit files when they help complete the user request.'},
          ...request.messages.map(mapMessage),
        ],
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {name: tool.name, description: tool.description, parameters: tool.inputSchema},
        })),
        tool_choice: 'auto',
        parallel_tool_calls: false,
      }),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      const safeDetail = detail.slice(0, 500).replaceAll(this.#apiKey, '[redacted]');
      throw new Error(`GenAPI request failed (${response.status}): ${safeDetail || response.statusText}`);
    }
    if (!response.body) throw new Error('GenAPI returned an empty response body.');

    const calls = new Map<number, StreamToolCall>();
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, {stream: true});
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let parsed: OpenAiChunk;
        try {
          parsed = JSON.parse(data) as OpenAiChunk;
        } catch {
          continue;
        }
        if (parsed.error?.message) throw new Error(`GenAPI error: ${parsed.error.message}`);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) yield {type: 'text', text: delta.content};
        for (const fragment of delta?.tool_calls ?? []) {
          const current = calls.get(fragment.index) ?? {id: '', name: '', arguments: ''};
          current.id += fragment.id ?? '';
          current.name += fragment.function?.name ?? '';
          current.arguments += fragment.function?.arguments ?? '';
          calls.set(fragment.index, current);
        }
        if (parsed.usage) {
          yield {type: 'usage', inputTokens: parsed.usage.prompt_tokens ?? 0, outputTokens: parsed.usage.completion_tokens ?? 0};
        }
      }
    }

    for (const call of [...calls.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)) {
      yield {type: 'tool_call', id: call.id, name: call.name, input: parseToolInput(call.arguments)};
    }
    yield {type: 'done'};
  }
}

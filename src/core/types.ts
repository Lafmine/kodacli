export type PermissionMode = 'default' | 'plan' | 'bypass';
export type ToolRisk = 'read' | 'write' | 'shell';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string | undefined;
  toolName?: string | undefined;
  toolCalls?: Array<{id: string; name: string; input: unknown}> | undefined;
}

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ChatRequest {
  messages: ChatMessage[];
  workspace: string;
  model: string;
  tools: ProviderTool[];
}

export type ProviderEvent =
  | {type: 'text'; text: string}
  | {type: 'tool_call'; id: string; name: string; input: unknown}
  | {type: 'usage'; inputTokens: number; outputTokens: number}
  | {type: 'error'; error: string}
  | {type: 'done'};

export interface ProviderConfig {
  provider: string;
  model: string;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
}

export interface ChatProvider {
  readonly name: string;
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  workspace: string;
  commandTimeoutMs: number;
  maxOutputChars: number;
}

export interface KodaTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  readonly inputSchema: import('zod').ZodType<TInput>;
  execute(context: ToolContext, input: TInput, signal: AbortSignal): Promise<ToolResult>;
}

export interface AgentEvent {
  type: 'text' | 'tool_start' | 'tool_result' | 'error' | 'done';
  text?: string;
  toolName?: string;
  result?: ToolResult;
}

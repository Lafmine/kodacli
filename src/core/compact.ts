import type {ChatMessage} from './types.js';

export const DEFAULT_COMPACT_TOKEN_LIMIT = 24_000;
const DEFAULT_KEEP_MESSAGES = 12;
const DEFAULT_SUMMARY_MAX_CHARS = 8_000;

export interface CompactOptions {
  tokenLimit?: number;
  keepMessages?: number;
  summaryMaxChars?: number;
  force?: boolean;
}

export interface CompactResult {
  messages: ChatMessage[];
  compacted: boolean;
  beforeMessages: number;
  afterMessages: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

export function estimateMessageTokens(message: ChatMessage): number {
  const toolCalls = message.toolCalls ? JSON.stringify(message.toolCalls).length : 0;
  const metadata = `${message.role}${message.toolName ?? ''}${message.toolCallId ?? ''}`.length;
  return Math.max(1, Math.ceil((message.content.length + toolCalls + metadata + 16) / 4));
}

export function estimateConversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function shorten(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function describeMessage(message: ChatMessage, index: number): string {
  const label = message.role === 'tool'
    ? `tool${message.toolName ? `:${message.toolName}` : ''}`
    : message.role;
  const toolCalls = message.toolCalls?.length
    ? ` Tool calls: ${message.toolCalls.map((call) => call.name).join(', ')}.`
    : '';
  const content = flatten(message.content) || '(empty)';
  return `${index + 1}. ${label}: ${shorten(content, 700)}${toolCalls}`;
}

function limitSummary(summary: string, maxChars: number): string {
  if (summary.length <= maxChars) return summary;
  const headChars = Math.floor(maxChars * 0.35);
  const tailChars = Math.max(0, maxChars - headChars - 20);
  return `${summary.slice(0, headChars)}\n...\n${summary.slice(-tailChars)}`;
}

export function compactMessages(messages: ChatMessage[], options: CompactOptions = {}): CompactResult {
  const tokenLimit = options.tokenLimit ?? DEFAULT_COMPACT_TOKEN_LIMIT;
  const keepMessages = Math.max(2, options.keepMessages ?? DEFAULT_KEEP_MESSAGES);
  const summaryMaxChars = Math.max(1_000, options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS);
  const estimatedTokensBefore = estimateConversationTokens(messages);
  const unchanged = {
    messages,
    compacted: false,
    beforeMessages: messages.length,
    afterMessages: messages.length,
    estimatedTokensBefore,
    estimatedTokensAfter: estimatedTokensBefore,
  };

  if (!options.force && estimatedTokensBefore <= tokenLimit) return unchanged;
  if (messages.length <= keepMessages + 1) return unchanged;

  const recent = messages.slice(-keepMessages);
  const older = messages.slice(0, -keepMessages);
  const summary = limitSummary(older.map(describeMessage).join('\n'), summaryMaxChars);
  const compactedMessage: ChatMessage = {
    role: 'assistant',
    content: [
      '[Compacted context summary]',
      'Older conversation messages were compressed locally to keep the session within the context limit.',
      summary,
    ].join('\n'),
  };
  const compacted = [compactedMessage, ...recent];

  return {
    messages: compacted,
    compacted: true,
    beforeMessages: messages.length,
    afterMessages: compacted.length,
    estimatedTokensBefore,
    estimatedTokensAfter: estimateConversationTokens(compacted),
  };
}

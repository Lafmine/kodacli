import {describe, expect, it} from 'vitest';
import {compactMessages, estimateConversationTokens} from '../src/core/compact.js';
import type {ChatMessage} from '../src/core/types.js';

function makeMessages(count: number): ChatMessage[] {
  return Array.from({length: count}, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index} ${'context '.repeat(80)}`,
  }));
}

describe('context compaction', () => {
  it('keeps short conversations unchanged unless forced', () => {
    const messages = makeMessages(4);
    const result = compactMessages(messages, {tokenLimit: 10_000});
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('compacts old messages and preserves recent context', () => {
    const messages = makeMessages(30);
    const result = compactMessages(messages, {force: true, keepMessages: 6});
    expect(result.compacted).toBe(true);
    expect(result.messages).toHaveLength(7);
    expect(result.messages[0]?.content).toContain('[Compacted context summary]');
    expect(result.messages.slice(1)).toEqual(messages.slice(-6));
  });

  it('reduces estimated tokens when compacting a large history', () => {
    const messages = makeMessages(80);
    const result = compactMessages(messages, {force: true, keepMessages: 10, summaryMaxChars: 2_000});
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore);
    expect(estimateConversationTokens(result.messages)).toBe(result.estimatedTokensAfter);
  });
});

import type {AgentEvent, ChatMessage, ChatProvider, KodaTool, PermissionMode, ToolContext} from './types.js';
import {resolvePermission} from './permissions.js';
import {providerTools} from '../tools/index.js';

export type AuthorizeTool = (tool: KodaTool, input: unknown) => Promise<boolean>;

export interface AgentRunOptions {
  provider: ChatProvider;
  messages: ChatMessage[];
  tools: KodaTool[];
  context: ToolContext;
  model: string;
  permissionMode: PermissionMode;
  authorize: AuthorizeTool;
  signal: AbortSignal;
  maxTurns?: number;
}

export async function* runAgent(options: AgentRunOptions): AsyncIterable<AgentEvent> {
  const messages = options.messages;
  const toolMap = new Map(options.tools.map((tool) => [tool.name, tool]));
  const maxTurns = options.maxTurns ?? 10;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let requestedTool = false;
    let assistantText = '';
    try {
      const events = options.provider.stream({
        messages,
        workspace: options.context.workspace,
        model: options.model,
        tools: providerTools(options.tools),
      }, options.signal);

      for await (const event of events) {
        if (event.type === 'text') {
          assistantText += event.text;
          yield {type: 'text', text: event.text};
        } else if (event.type === 'error') {
          yield {type: 'error', text: event.error};
          return;
        } else if (event.type === 'tool_call') {
          requestedTool = true;
          messages.push({role: 'assistant', content: assistantText, toolCalls: [{id: event.id, name: event.name, input: event.input}]});
          assistantText = '';
          const tool = toolMap.get(event.name);
          if (!tool) {
            messages.push({role: 'tool', toolCallId: event.id, toolName: event.name, content: 'Unknown tool.'});
            yield {type: 'error', text: `Unknown tool: ${event.name}`};
            break;
          }
          let input: unknown;
          try {
            input = tool.inputSchema.parse(event.input);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            messages.push({role: 'tool', toolCallId: event.id, toolName: tool.name, content: `Invalid input: ${detail}`});
            yield {type: 'error', text: `Invalid input for ${tool.name}.`};
            break;
          }

          const decision = resolvePermission(options.permissionMode, tool.risk);
          const allowed = decision === 'allow' || (decision === 'ask' && await options.authorize(tool, input));
          yield {type: 'tool_start', toolName: tool.name};
          if (!allowed) {
            const reason = decision === 'deny' ? 'Blocked in plan mode.' : 'Denied by user.';
            const result = {ok: false, output: reason};
            messages.push({role: 'tool', toolCallId: event.id, toolName: tool.name, content: reason});
            yield {type: 'tool_result', toolName: tool.name, result};
            break;
          }

          try {
            const result = await tool.execute(options.context, input as never, options.signal);
            messages.push({role: 'tool', toolCallId: event.id, toolName: tool.name, content: result.output});
            yield {type: 'tool_result', toolName: tool.name, result};
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            messages.push({role: 'tool', toolCallId: event.id, toolName: tool.name, content: detail});
            yield {type: 'tool_result', toolName: tool.name, result: {ok: false, output: detail}};
          }
          break;
        }
      }
      if (assistantText) messages.push({role: 'assistant', content: assistantText});
      if (!requestedTool) {
        yield {type: 'done'};
        return;
      }
    } catch (error) {
      const detail = options.signal.aborted ? 'Request cancelled.' : error instanceof Error ? error.message : String(error);
      yield {type: 'error', text: detail};
      return;
    }
  }
  yield {type: 'error', text: `Agent stopped after ${maxTurns} tool turns.`};
}

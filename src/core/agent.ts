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
  systemPrompt?: string | undefined;
}

function detectOpenFileRequest(messages: ChatMessage[]): {path: string} | undefined {
  const last = messages.at(-1);
  if (last?.role !== 'user') return undefined;
  const match = /^(?:please\s+)?(?:open|открой|открыть)\s+(?:(?:the\s+)?(?:file|folder|directory)|файл|папку|директорию)?\s*(.+)$/iu.exec(last.content.trim());
  const requestedPath = match?.[1]?.trim().replace(/^["'`«]+|["'`»]+$/g, '').replace(/[.!?]+$/u, '').trim();
  return requestedPath ? {path: requestedPath} : undefined;
}

function detectGeneratedFileRequest(messages: ChatMessage[], assistantText: string): {path: string; content: string} | undefined {
  let last: ChatMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      last = messages[index];
      break;
    }
  }
  if (!last) return undefined;

  const userText = last.content.trim();
  const wantsFile = /(?:создай|сделай|напиши|сгенерируй|запиши|create|make|write|build)/iu.test(userText) &&
    /(?:сайт|страниц|html|файл|website|page|file)/iu.test(userText);
  if (!wantsFile) return undefined;

  const codeBlock = /```([a-z0-9_-]*)\r?\n([\s\S]*?)```/i.exec(assistantText);
  if (!codeBlock?.[2]) return undefined;

  const language = codeBlock[1]?.toLowerCase();
  const explicitPath = /(?:в\s+файл|файл|file|as)\s+["'`«]?([a-z0-9_.\-/\\а-яё]+?\.[a-z0-9]+)["'`»]?/iu.exec(userText)?.[1];
  const path = explicitPath ?? (language === 'html' || /(?:сайт|html|website|page)/iu.test(userText) ? 'index.html' : 'output.txt');
  return {path, content: codeBlock[2].trim()};
}

async function* executeTool(options: AgentRunOptions, tool: KodaTool, input: unknown, toolCallId: string): AsyncIterable<AgentEvent> {
  let parsedInput: unknown;
  try {
    parsedInput = tool.inputSchema.parse(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    options.messages.push({role: 'tool', toolCallId, toolName: tool.name, content: `Invalid input: ${detail}`});
    yield {type: 'error', text: `Invalid input for ${tool.name}.`};
    return;
  }

  const decision = resolvePermission(options.permissionMode, tool.risk);
  const allowed = decision === 'allow' || (decision === 'ask' && await options.authorize(tool, parsedInput));
  yield {type: 'tool_start', toolName: tool.name};
  if (!allowed) {
    const reason = decision === 'deny' ? 'Blocked in plan mode.' : 'Denied by user.';
    const result = {ok: false, output: reason};
    options.messages.push({role: 'tool', toolCallId, toolName: tool.name, content: reason});
    yield {type: 'tool_result', toolName: tool.name, result};
    return;
  }

  try {
    const result = await tool.execute(options.context, parsedInput as never, options.signal);
    options.messages.push({role: 'tool', toolCallId, toolName: tool.name, content: result.output});
    yield {type: 'tool_result', toolName: tool.name, result};
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    options.messages.push({role: 'tool', toolCallId, toolName: tool.name, content: detail});
    yield {type: 'tool_result', toolName: tool.name, result: {ok: false, output: detail}};
  }
}

export async function* runAgent(options: AgentRunOptions): AsyncIterable<AgentEvent> {
  const messages = options.messages;
  const toolMap = new Map(options.tools.map((tool) => [tool.name, tool]));
  const maxTurns = options.maxTurns ?? 10;
  const openRequest = detectOpenFileRequest(messages);
  const openFileTool = openRequest ? toolMap.get('open_file') : undefined;
  if (openRequest && openFileTool) {
    messages.push({role: 'assistant', content: '', toolCalls: [{id: 'local_open_file', name: openFileTool.name, input: openRequest}]});
    yield* executeTool(options, openFileTool, openRequest, 'local_open_file');
    yield {type: 'done'};
    return;
  }

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let requestedTool = false;
    let assistantText = '';
    try {
      const events = options.provider.stream({
        messages,
        workspace: options.context.workspace,
        model: options.model,
        tools: providerTools(options.tools),
        systemPrompt: options.systemPrompt,
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
          yield* executeTool(options, tool, event.input, event.id);
          break;
        }
      }
      if (assistantText) messages.push({role: 'assistant', content: assistantText});
      if (!requestedTool) {
        const generatedFile = detectGeneratedFileRequest(messages, assistantText);
        const writeFileTool = generatedFile ? toolMap.get('write_file') : undefined;
        if (generatedFile && writeFileTool) {
          messages.push({role: 'assistant', content: '', toolCalls: [{id: 'local_write_generated_file', name: writeFileTool.name, input: generatedFile}]});
          yield* executeTool(options, writeFileTool, generatedFile, 'local_write_generated_file');
        }
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

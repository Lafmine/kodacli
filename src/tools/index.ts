import type {KodaTool, ProviderTool} from '../core/types.js';
import {z} from 'zod';
import {editFileTool, listFilesTool, readFileTool, writeFileTool} from './file-tools.js';
import {searchTool, shellTool} from './process-tools.js';

export const builtInTools: KodaTool[] = [readFileTool, listFilesTool, searchTool, writeFileTool, editFileTool, shellTool];

export function providerTools(tools: KodaTool[]): ProviderTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema),
  }));
}

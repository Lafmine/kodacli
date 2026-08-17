import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {KodaTool} from '../core/types.js';
import {resolveWorkspacePath, truncateOutput} from './workspace.js';

export const readFileTool: KodaTool<{path: string}> = {
  name: 'read_file',
  description: 'Read a UTF-8 text file inside the workspace.',
  risk: 'read',
  inputSchema: z.object({path: z.string().min(1)}),
  async execute(context, input) {
    const file = await resolveWorkspacePath(context.workspace, input.path);
    const result = truncateOutput(await readFile(file, 'utf8'), context.maxOutputChars);
    return {ok: true, output: result.output, metadata: {truncated: result.truncated}};
  },
};

export const listFilesTool: KodaTool<{path?: string | undefined; limit?: number | undefined}> = {
  name: 'list_files',
  description: 'List files recursively inside a workspace directory.',
  risk: 'read',
  inputSchema: z.object({path: z.string().optional(), limit: z.number().int().min(1).max(2000).optional()}),
  async execute(context, input, signal) {
    const directory = await resolveWorkspacePath(context.workspace, input.path ?? '.');
    const limit = input.limit ?? 200;
    const files: string[] = [];
    const visit = async (current: string): Promise<void> => {
      if (signal.aborted || files.length >= limit) return;
      const entries = await readdir(current, {withFileTypes: true});
      for (const entry of entries) {
        if (files.length >= limit || signal.aborted) break;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile()) files.push(path.relative(context.workspace, full));
      }
    };
    await visit(directory);
    if (signal.aborted) throw new Error('Operation aborted.');
    return {ok: true, output: files.join('\n') || '(no files)', metadata: {count: files.length, limited: files.length >= limit}};
  },
};

export const writeFileTool: KodaTool<{path: string; content: string}> = {
  name: 'write_file',
  description: 'Create or overwrite a UTF-8 file inside the workspace.',
  risk: 'write',
  inputSchema: z.object({path: z.string().min(1), content: z.string()}),
  async execute(context, input) {
    const file = await resolveWorkspacePath(context.workspace, input.path, true);
    await writeFile(file, input.content, 'utf8');
    return {ok: true, output: `Wrote ${Buffer.byteLength(input.content)} bytes to ${path.relative(context.workspace, file)}.`};
  },
};

export const editFileTool: KodaTool<{path: string; oldText: string; newText: string}> = {
  name: 'edit_file',
  description: 'Replace one exact occurrence in a UTF-8 workspace file.',
  risk: 'write',
  inputSchema: z.object({path: z.string().min(1), oldText: z.string().min(1), newText: z.string()}),
  async execute(context, input) {
    const file = await resolveWorkspacePath(context.workspace, input.path);
    const content = await readFile(file, 'utf8');
    const first = content.indexOf(input.oldText);
    if (first < 0) return {ok: false, output: 'The requested text was not found.'};
    if (content.indexOf(input.oldText, first + input.oldText.length) >= 0) return {ok: false, output: 'The requested text is not unique.'};
    await writeFile(file, `${content.slice(0, first)}${input.newText}${content.slice(first + input.oldText.length)}`, 'utf8');
    return {ok: true, output: `Edited ${path.relative(context.workspace, file)}.`};
  },
};

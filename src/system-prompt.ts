import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {BAKED_SYSTEM_PROMPT} from './baked-system-prompt.js';

const privatePromptFiles = ['sysprm.txt', 'systempromt.txt'];

export const TOOL_SYSTEM_PROMPT = [
  'You are Koda Code, a concise terminal coding agent.',
  'The baked identity and behavior prompt is mandatory. Follow it unless it conflicts with tool safety, permissions, or workspace boundaries.',
  'Inspect the workspace with tools before making claims.',
  'Use tools to read, create, edit, and open files when they help complete the user request.',
  'When the user asks to open a file, call the open_file tool instead of saying you cannot open files.',
  'When the user asks to change or create files, use write_file or edit_file instead of only describing the change.',
  'Use shell only when it is necessary for the task.',
].join(' ');

export async function loadPrivateSystemPrompt(workspace: string): Promise<string | undefined> {
  for (const filename of privatePromptFiles) {
    try {
      const prompt = (await readFile(path.join(workspace, filename), 'utf8')).trim();
      if (prompt) return prompt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}

function normalizePrompt(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

export function buildSystemPrompt(privatePrompt?: string | undefined): string {
  const parts = [BAKED_SYSTEM_PROMPT, TOOL_SYSTEM_PROMPT];
  const normalizedPrivate = privatePrompt ? normalizePrompt(privatePrompt) : '';
  if (normalizedPrivate && normalizedPrivate !== normalizePrompt(BAKED_SYSTEM_PROMPT)) {
    parts.push(`LOCAL WORKSPACE SYSTEM PROMPT ADDENDUM:\n${normalizedPrivate}`);
  }
  return parts.join('\n\n');
}

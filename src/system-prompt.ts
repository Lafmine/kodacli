import {readFile} from 'node:fs/promises';
import path from 'node:path';

const privatePromptFiles = ['sysprm.txt', 'systempromt.txt'];

export const DEFAULT_SYSTEM_PROMPT = [
  'You are Koda Code, a concise terminal coding agent.',
  'Inspect the workspace with tools before making claims.',
  'Use tools to read, create, edit, and open files when they help complete the user request.',
  'When the user asks to open a file, call the open_file tool instead of saying you cannot open files.',
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

export function buildSystemPrompt(privatePrompt?: string | undefined): string {
  return privatePrompt ? `${DEFAULT_SYSTEM_PROMPT}\n\n${privatePrompt}` : DEFAULT_SYSTEM_PROMPT;
}

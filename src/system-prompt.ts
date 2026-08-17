import {readFile} from 'node:fs/promises';
import path from 'node:path';

const privatePromptFiles = ['sysprm.txt', 'systempromt.txt'];

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

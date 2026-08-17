import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {getConfigDirectory} from './config.js';
import type {ChatMessage} from './core/types.js';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolCalls: z.array(z.object({id: z.string(), name: z.string(), input: z.unknown()})).optional(),
});

const sessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workspace: z.string(),
  provider: z.string(),
  model: z.string(),
  messages: z.array(messageSchema),
});

export type Session = z.infer<typeof sessionSchema>;

export function createSession(workspace: string, provider: string, model: string): Session {
  const now = new Date().toISOString();
  return {id: randomUUID(), createdAt: now, updatedAt: now, workspace, provider, model, messages: []};
}

export class SessionStore {
  readonly directory: string;

  constructor(configDirectory = getConfigDirectory()) {
    this.directory = path.join(configDirectory, 'sessions');
  }

  async save(session: Session): Promise<void> {
    await mkdir(this.directory, {recursive: true});
    const updated = {...session, updatedAt: new Date().toISOString()};
    await writeFile(path.join(this.directory, `${session.id}.json`), `${JSON.stringify(updated, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  }

  async load(id: string): Promise<Session | undefined> {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return undefined;
    try {
      return sessionSchema.parse(JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8')));
    } catch {
      return undefined;
    }
  }

  async latest(workspace?: string): Promise<Session | undefined> {
    try {
      const files = (await readdir(this.directory)).filter((file) => file.endsWith('.json'));
      const sessions = await Promise.all(files.map((file) => this.load(file.slice(0, -5))));
      return sessions
        .filter((session): session is Session => Boolean(session && (!workspace || session.workspace === workspace)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    } catch {
      return undefined;
    }
  }
}

export function appendMessage(session: Session, message: ChatMessage): Session {
  return {...session, messages: [...session.messages, message]};
}

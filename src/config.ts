import {readFile} from 'node:fs/promises';
import {homedir, platform} from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import type {PermissionMode} from './core/types.js';

export const configSchema = z.object({
  provider: z.string().default('demo'),
  model: z.string().default('demo-v1'),
  baseUrl: z.url().optional(),
  permissionMode: z.enum(['default', 'plan', 'bypass']).default('default'),
  theme: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#d97757'),
  shell: z.string().optional(),
  commandTimeoutMs: z.number().int().min(100).max(300_000).default(30_000),
});

export type KodaConfig = z.infer<typeof configSchema>;

export function getConfigDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === 'win32') return path.join(env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'Koda');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'koda');
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return {};
  }
}

export async function loadConfig(workspace: string, overrides: Partial<KodaConfig> = {}): Promise<KodaConfig> {
  const user = await readJson(path.join(getConfigDirectory(), 'config.json'));
  const project = await readJson(path.join(workspace, '.koda.json'));
  const safeProject = configSchema.partial().pick({model: true, permissionMode: true, theme: true, shell: true, commandTimeoutMs: true}).safeParse(project);
  const userParsed = configSchema.partial().safeParse(user);
  const genApiEnvironment = process.env.KODA_API_KEY ? {
    provider: 'genapi',
    model: process.env.KODA_MODEL ?? 'gpt-4o-mini',
    baseUrl: process.env.KODA_BASE_URL ?? 'https://proxy.gen-api.ru/v1',
  } : {};
  return configSchema.parse({
    ...(userParsed.success ? userParsed.data : {}),
    ...(safeProject.success ? safeProject.data : {}),
    ...genApiEnvironment,
    ...overrides,
  });
}

export function withPermissionMode(config: KodaConfig, mode: PermissionMode): KodaConfig {
  return {...config, permissionMode: mode};
}

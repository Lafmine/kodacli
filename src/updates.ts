import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {platform} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import {getConfigDirectory} from './config.js';

const execFileAsync = promisify(execFile);
const updateIntervalMs = 12 * 60 * 60 * 1000;
const updateStateSchema = z.object({lastCheckedAt: z.string().optional()});

async function readUpdateState(file: string): Promise<z.infer<typeof updateStateSchema>> {
  try {
    return updateStateSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return {};
  }
}

function shouldSkipAutoUpdate(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (env.KODA_AUTO_UPDATE === '0' || env.KODA_NO_AUTO_UPDATE === '1') return true;
  return argv.includes('--version') || argv.includes('-V') || argv.includes('--help') || argv.includes('-h');
}

function isUpdateDue(lastCheckedAt?: string): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  return Number.isNaN(last) || Date.now() - last >= updateIntervalMs;
}

export async function maybeAutoUpdate(argv = process.argv, env = process.env, configDirectory = getConfigDirectory(env)): Promise<void> {
  if (shouldSkipAutoUpdate(argv, env)) return;

  const updatesDirectory = path.join(configDirectory, 'updates');
  const stateFile = path.join(updatesDirectory, 'auto-update.json');
  const state = await readUpdateState(stateFile);
  if (!isUpdateDue(state.lastCheckedAt)) return;

  await mkdir(updatesDirectory, {recursive: true});
  await writeFile(stateFile, `${JSON.stringify({lastCheckedAt: new Date().toISOString()}, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});

  const npmCommand = platform() === 'win32' ? 'npm.cmd' : 'npm';
  try {
    process.stderr.write('[koda] Checking for updates...\n');
    await execFileAsync(npmCommand, ['install', '--global', 'github:Lafmine/kodacli', '--no-audit', '--no-fund'], {
      env,
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[koda] Auto-update skipped: ${detail}\n`);
  }
}

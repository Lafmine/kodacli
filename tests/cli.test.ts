import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const execFileAsync = promisify(execFile);
const cli = path.resolve('dist/cli.js');
const demoEnvironment = {...process.env, KODA_API_KEY: '', KODA_PROVIDER: 'demo', KODA_AUTO_UPDATE: '0'};

describe('CLI', () => {
  it('prints its version', async () => {
    const {stdout} = await execFileAsync(process.execPath, [cli, '--version'], {env: demoEnvironment});
    expect(stdout.trim()).toBe('0.1.1');
  });

  it('runs demo provider in print mode', async () => {
    const {stdout} = await execFileAsync(process.execPath, [cli, '--print', 'hello'], {cwd: path.resolve('.'), env: demoEnvironment});
    expect(stdout).toContain('local demo mode');
  });

  it('uses exit code 2 for invalid CLI arguments', async () => {
    await expect(execFileAsync(process.execPath, [cli, '--permission-mode', 'unsafe'], {env: demoEnvironment})).rejects.toMatchObject({code: 2});
  });
});

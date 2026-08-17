import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export async function getGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const {stdout} = await execFileAsync('git', ['branch', '--show-current'], {cwd, windowsHide: true});
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

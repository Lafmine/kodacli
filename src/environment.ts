import path from 'node:path';
import {loadEnvFile} from 'node:process';

export function loadWorkspaceEnvironment(workspace: string): void {
  try {
    loadEnvFile(path.join(workspace, '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

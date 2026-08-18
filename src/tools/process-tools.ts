import {spawn} from 'node:child_process';
import {platform} from 'node:os';
import {z} from 'zod';
import type {KodaTool, ToolResult} from '../core/types.js';
import {resolveWorkspacePath, truncateOutput} from './workspace.js';

function runProcess(command: string, args: string[], options: {cwd: string; timeoutMs: number; maxChars: number; signal: AbortSignal}): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: options.cwd, windowsHide: true, shell: false});
    let output = '';
    let settled = false;
    const collect = (chunk: Buffer) => { output += chunk.toString('utf8'); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      child.kill();
      finish({ok: false, output: 'Command aborted.'});
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ok: false, output: `Command timed out after ${options.timeoutMs}ms.`});
    }, options.timeoutMs);
    options.signal.addEventListener('abort', abort, {once: true});
    child.on('error', reject);
    child.on('close', (code) => {
      const result = truncateOutput(output.trim(), options.maxChars);
      finish({ok: code === 0, output: result.output || `(exit ${code ?? 1})`, metadata: {exitCode: code, truncated: result.truncated}});
    });
  });
}

export const searchTool: KodaTool<{pattern: string; path?: string | undefined}> = {
  name: 'search',
  description: 'Search workspace text with ripgrep.',
  risk: 'read',
  inputSchema: z.object({pattern: z.string().min(1), path: z.string().optional()}),
  async execute(context, input, signal) {
    const target = await resolveWorkspacePath(context.workspace, input.path ?? '.');
    return runProcess('rg', ['--line-number', '--color', 'never', '--glob', '!node_modules/**', input.pattern, target], {
      cwd: context.workspace, timeoutMs: context.commandTimeoutMs, maxChars: context.maxOutputChars, signal,
    });
  },
};

export const shellTool: KodaTool<{command: string}> = {
  name: 'shell',
  description: 'Run a shell command in the workspace.',
  risk: 'shell',
  inputSchema: z.object({command: z.string().min(1)}),
  async execute(context, input, signal) {
    const shell = platform() === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = platform() === 'win32'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', input.command]
      : ['-c', input.command];
    return runProcess(shell, args, {cwd: context.workspace, timeoutMs: context.commandTimeoutMs, maxChars: context.maxOutputChars, signal});
  },
};

export const openFileTool: KodaTool<{path: string}> = {
  name: 'open_file',
  description: 'Open an existing workspace file or folder in the operating system default app.',
  risk: 'shell',
  inputSchema: z.object({path: z.string().min(1)}),
  async execute(context, input, signal) {
    const target = await resolveWorkspacePath(context.workspace, input.path);
    const command = platform() === 'win32' ? 'powershell.exe' : platform() === 'darwin' ? 'open' : 'xdg-open';
    const args = platform() === 'win32'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -LiteralPath $args[0]', target]
      : [target];
    const result = await runProcess(command, args, {cwd: context.workspace, timeoutMs: context.commandTimeoutMs, maxChars: context.maxOutputChars, signal});
    return result.ok ? {ok: true, output: `Opened ${target}.`} : result;
  },
};

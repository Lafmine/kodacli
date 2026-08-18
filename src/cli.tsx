#!/usr/bin/env node
import React from 'react';
import {realpath, stat} from 'node:fs/promises';
import {Command, InvalidArgumentError, Option} from 'commander';
import {render} from 'ink';
import {loadConfig} from './config.js';
import type {KodaConfig} from './config.js';
import {loadWorkspaceEnvironment} from './environment.js';
import {runAgent} from './core/agent.js';
import type {PermissionMode} from './core/types.js';
import {getGitBranch} from './git.js';
import {createProvider} from './providers/index.js';
import {appendMessage, createSession, SessionStore} from './sessions.js';
import {builtInTools} from './tools/index.js';
import {App} from './ui/App.js';
import {buildSystemPrompt, loadPrivateSystemPrompt} from './system-prompt.js';

const VERSION = '0.1.1';

interface CliOptions {
  print?: boolean;
  continue?: boolean;
  session?: string;
  permissionMode?: PermissionMode;
  cwd: string;
}

function permissionMode(value: string): PermissionMode {
  if (value === 'default' || value === 'plan' || value === 'bypass') return value;
  throw new InvalidArgumentError('Expected default, plan, or bypass.');
}

async function resolveSession(options: CliOptions, workspace: string, config: KodaConfig, store: SessionStore) {
  const selected = options.session ? await store.load(options.session) : options.continue ? await store.latest(workspace) : undefined;
  if (options.session && !selected) throw new Error(`Session "${options.session}" was not found or is invalid.`);
  return selected ?? createSession(workspace, config.provider, config.model);
}

async function runPrint(prompt: string, options: CliOptions, workspace: string, config: KodaConfig, systemPrompt?: string): Promise<void> {
  const store = new SessionStore();
  const session = appendMessage(await resolveSession(options, workspace, config, store), {role: 'user', content: prompt});
  const provider = createProvider(config);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  try {
    for await (const event of runAgent({
      provider,
      messages: session.messages,
      tools: builtInTools,
      context: {workspace, commandTimeoutMs: config.commandTimeoutMs, maxOutputChars: 40_000},
      model: config.model,
      permissionMode: config.permissionMode,
      authorize: async () => false,
      signal: controller.signal,
      systemPrompt,
    })) {
      if (event.type === 'text') process.stdout.write(event.text ?? '');
      else if (event.type === 'tool_start') process.stderr.write(`\n[${event.toolName}]\n`);
      else if (event.type === 'tool_result') process.stdout.write(`${event.result?.output ?? ''}\n`);
      else if (event.type === 'error') process.stderr.write(`\nError: ${event.text}\n`);
    }
    process.stdout.write('\n');
    await store.save(session);
    if (controller.signal.aborted) process.exitCode = 130;
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
}

async function main(): Promise<void> {
  const program = new Command()
    .name('koda')
    .description('Koda Code — terminal coding agent scaffold')
    .version(VERSION)
    .argument('[prompt...]', 'initial prompt')
    .option('-p, --print', 'print the response without opening the interactive UI')
    .option('-c, --continue', 'continue the latest session in this workspace')
    .option('-s, --session <id>', 'resume a session by ID')
    .addOption(new Option('--permission-mode <mode>', 'tool permission mode').argParser(permissionMode))
    .option('--cwd <path>', 'workspace directory', process.cwd());

  program.exitOverride();
  let parsed: Command;
  try {
    parsed = program.parse(process.argv);
  } catch (error) {
    if ((error as {code?: string}).code === 'commander.helpDisplayed' || (error as {code?: string}).code === 'commander.version') return;
    process.exitCode = 2;
    return;
  }
  const options = parsed.opts<CliOptions>();
  const prompt = (parsed.args as string[]).join(' ').trim();
  const workspace = await realpath(options.cwd);
  if (!(await stat(workspace)).isDirectory()) throw new Error(`Not a directory: ${workspace}`);
  loadWorkspaceEnvironment(workspace);
  const config = await loadConfig(workspace, options.permissionMode ? {permissionMode: options.permissionMode} : {});
  const systemPrompt = buildSystemPrompt(await loadPrivateSystemPrompt(workspace));

  if (options.print) {
    if (!prompt) throw new Error('--print requires a prompt.');
    await runPrint(prompt, options, workspace, config, systemPrompt);
    return;
  }

  const store = new SessionStore();
  const [session, branch] = await Promise.all([resolveSession(options, workspace, config, store), getGitBranch(workspace)]);
  const provider = createProvider(config);
  const instance = render(<App workspace={workspace} branch={branch} config={config} provider={provider} tools={builtInTools} session={session} store={store} systemPrompt={systemPrompt} initialPrompt={prompt || undefined} />);
  await instance.waitUntilExit();
}

main().catch((error: unknown) => {
  process.stderr.write(`Koda error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = process.exitCode || 1;
});

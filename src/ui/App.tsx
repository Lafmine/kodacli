import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import type {KodaConfig} from '../config.js';
import {withPermissionMode} from '../config.js';
import {runAgent} from '../core/agent.js';
import type {KodaTool, PermissionMode} from '../core/types.js';
import type {ChatProvider} from '../core/types.js';
import {appendMessage, createSession, type Session, SessionStore} from '../sessions.js';

interface TranscriptEntry {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  text: string;
}

interface ApprovalRequest {
  tool: KodaTool;
  input: unknown;
  resolve: (allowed: boolean) => void;
}

interface SlashCommand {
  name: string;
  description: string;
}

export interface AppProps {
  workspace: string;
  branch?: string | undefined;
  config: KodaConfig;
  provider: ChatProvider;
  tools: KodaTool[];
  session: Session;
  store: SessionStore;
  initialPrompt?: string | undefined;
  systemPrompt?: string | undefined;
}

export const slashCommands: SlashCommand[] = [
  {name: '/help', description: 'Show all commands and keyboard shortcuts'},
  {name: '/clear', description: 'Clear the visible conversation'},
  {name: '/status', description: 'Show session, provider, workspace, and permissions'},
  {name: '/config', description: 'Show the active Koda configuration'},
  {name: '/permissions', description: 'Cycle default, plan, and bypass modes'},
  {name: '/resume', description: 'Resume the latest session in this workspace'},
  {name: '/new', description: 'Start a new empty session'},
  {name: '/exit', description: 'Exit Koda Code'},
];

const HELP = slashCommands.map((command) => `${command.name.padEnd(14)} ${command.description}`).join('\n');
const modes: PermissionMode[] = ['default', 'plan', 'bypass'];
const thinkingFrames = ['.', '..', '...'];

interface CommandPaletteProps {
  commands: SlashCommand[];
  selectedIndex: number;
  color: string;
}

function CommandPalette({commands, selectedIndex, color}: CommandPaletteProps) {
  if (commands.length === 0) {
    return <Box paddingX={1}><Text dimColor>No matching command</Text></Box>;
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text dimColor>Commands</Text>
      {commands.map((command, index) => (
        <Box key={command.name}>
          <Text color={index === selectedIndex ? color : 'white'} bold={index === selectedIndex}>
            {index === selectedIndex ? '› ' : '  '}{command.name.padEnd(16)}
          </Text>
          <Text dimColor>{command.description}</Text>
        </Box>
      ))}
      <Text dimColor>↑↓ select  Enter run  Tab complete  Esc close</Text>
    </Box>
  );
}

export function App(props: AppProps) {
  const {exit} = useApp();
  const [config, setConfig] = useState(props.config);
  const [session, setSession] = useState(props.session);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [approval, setApproval] = useState<ApprovalRequest>();
  const controller = useRef<AbortController | undefined>(undefined);
  const nextId = useRef(1);
  const initialSubmitted = useRef(false);
  const commandQuery = input.startsWith('/') && !input.includes(' ') ? input.toLowerCase() : '';
  const matchingCommands = useMemo(
    () => commandQuery ? slashCommands.filter((command) => command.name.startsWith(commandQuery)) : [],
    [commandQuery],
  );
  const commandPaletteOpen = commandQuery.length > 0 && !busy;

  const addEntry = useCallback((role: TranscriptEntry['role'], text: string) => {
    setTranscript((current) => [...current, {id: nextId.current++, role, text}]);
  }, []);

  const appendAssistant = useCallback((text: string) => {
    setTranscript((current) => {
      const last = current.at(-1);
      if (last?.role === 'assistant') return [...current.slice(0, -1), {...last, text: last.text + text}];
      return [...current, {id: nextId.current++, role: 'assistant', text}];
    });
  }, []);

  const handleCommand = useCallback(async (command: string): Promise<boolean> => {
    const [name, argument] = command.slice(1).trim().split(/\s+/, 2);
    if (name === 'help') addEntry('system', HELP);
    else if (name === 'clear') setTranscript([]);
    else if (name === 'status') addEntry('system', `Session: ${session.id}\nWorkspace: ${props.workspace}\nPermission mode: ${config.permissionMode}`);
    else if (name === 'config') addEntry('system', JSON.stringify({permissionMode: config.permissionMode, theme: config.theme, commandTimeoutMs: config.commandTimeoutMs}, null, 2));
    else if (name === 'permissions') {
      const requested = modes.includes(argument as PermissionMode) ? argument as PermissionMode : modes[(modes.indexOf(config.permissionMode) + 1) % modes.length] ?? 'default';
      setConfig((current) => withPermissionMode(current, requested));
      addEntry('system', `Permission mode changed to ${requested}.`);
    } else if (name === 'new') {
      const fresh = createSession(props.workspace, config.provider, config.model);
      setSession(fresh);
      setTranscript([]);
      await props.store.save(fresh);
      addEntry('system', `Started session ${fresh.id}.`);
    } else if (name === 'resume') {
      const latest = await props.store.latest(props.workspace);
      if (latest) {
        setSession(latest);
        setTranscript(latest.messages.filter((message) => message.role !== 'tool').map((message) => ({id: nextId.current++, role: message.role, text: message.content})));
        addEntry('system', `Resumed session ${latest.id}.`);
      } else addEntry('error', 'No saved session was found for this workspace.');
    } else if (name === 'exit') exit();
    else return false;
    return true;
  }, [addEntry, config, exit, props.store, props.workspace, session.id]);

  const submit = useCallback(async (value: string) => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setInput('');
    setHistoryIndex(-1);
    setHistory((current) => [...current.filter((item) => item !== prompt), prompt].slice(-100));
    if (prompt.startsWith('/') && await handleCommand(prompt)) return;

    addEntry('user', prompt);
    setBusy(true);
    const abortController = new AbortController();
    controller.current = abortController;
    const nextSession = appendMessage(session, {role: 'user', content: prompt});
    try {
      const events = runAgent({
        provider: props.provider,
        messages: nextSession.messages,
        tools: props.tools,
        context: {workspace: props.workspace, commandTimeoutMs: config.commandTimeoutMs, maxOutputChars: 40_000},
        model: config.model,
        permissionMode: config.permissionMode,
        authorize: (tool, toolInput) => new Promise<boolean>((resolve) => setApproval({tool, input: toolInput, resolve})),
        signal: abortController.signal,
        systemPrompt: props.systemPrompt,
      });
      for await (const event of events) {
        if (event.type === 'text' && event.text) appendAssistant(event.text);
        else if (event.type === 'tool_start') addEntry('tool', `Running ${event.toolName}…`);
        else if (event.type === 'tool_result' && event.result) addEntry(event.result.ok ? 'tool' : 'error', `${event.toolName}: ${event.result.output}`);
        else if (event.type === 'error' && event.text) addEntry('error', event.text);
      }
      const saved = {...nextSession, messages: [...nextSession.messages]};
      setSession(saved);
      await props.store.save(saved);
    } finally {
      controller.current = undefined;
      setBusy(false);
    }
  }, [addEntry, appendAssistant, busy, config, handleCommand, props.provider, props.store, props.systemPrompt, props.tools, props.workspace, session]);

  useEffect(() => {
    if (!initialSubmitted.current && props.initialPrompt) {
      initialSubmitted.current = true;
      void submit(props.initialPrompt);
    }
  }, [props.initialPrompt, submit]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    if (!busy) {
      setThinkingFrame(0);
      return undefined;
    }
    const timer = setInterval(() => setThinkingFrame((frame) => (frame + 1) % thinkingFrames.length), 180);
    return () => clearInterval(timer);
  }, [busy]);

  useInput((character, key) => {
    if (approval) {
      if (character.toLowerCase() === 'y') {
        approval.resolve(true);
        setApproval(undefined);
      } else if (character.toLowerCase() === 'n' || key.escape) {
        approval.resolve(false);
        setApproval(undefined);
      }
      return;
    }
    if (key.ctrl && character === 'c') {
      if (busy) controller.current?.abort();
      else if (input) setInput('');
      else {
        process.exitCode = 130;
        exit();
      }
      return;
    }
    if (key.ctrl && character === 'd' && !busy) {
      exit();
      return;
    }
    if (busy) return;
    if (commandPaletteOpen && key.escape) {
      setInput('');
      return;
    }
    if (commandPaletteOpen && key.upArrow) {
      setCommandIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (commandPaletteOpen && key.downArrow) {
      setCommandIndex((current) => Math.min(matchingCommands.length - 1, current + 1));
      return;
    }
    if (commandPaletteOpen && key.tab && matchingCommands[commandIndex]) {
      setInput(matchingCommands[commandIndex].name);
      return;
    }
    if (key.return) {
      if (key.shift) setInput((current) => `${current}\n`);
      else if (commandPaletteOpen && matchingCommands[commandIndex]) void submit(matchingCommands[commandIndex].name);
      else void submit(input);
    } else if (key.backspace || key.delete) setInput((current) => current.slice(0, -1));
    else if (key.upArrow && history.length > 0) {
      const index = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(index);
      setInput(history[history.length - 1 - index] ?? '');
    } else if (key.downArrow) {
      const index = historyIndex - 1;
      setHistoryIndex(index);
      setInput(index >= 0 ? history[history.length - 1 - index] ?? '' : '');
    } else if (character && !key.ctrl && !key.meta) setInput((current) => current + character);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor={config.theme} paddingX={1} flexDirection="column">
        <Text bold color={config.theme}>Koda Code</Text>
        <Text dimColor>{props.workspace}{props.branch ? `  ·  ${props.branch}` : ''}</Text>
        <Text>Claude Opus 5  ·  <Text color={config.theme}>{config.permissionMode}</Text></Text>
      </Box>
      {transcript.map((entry) => (
        <Box key={entry.id} marginTop={1}>
          <Text color={entry.role === 'error' ? 'red' : entry.role === 'user' ? config.theme : entry.role === 'tool' ? 'yellow' : 'white'}>
            {entry.role === 'user' ? '› ' : entry.role === 'tool' ? '⚙ ' : entry.role === 'error' ? '✗ ' : ''}{entry.text}
          </Text>
        </Box>
      ))}
      {approval ? (
        <Box marginTop={1}><Text color="yellow">Allow {approval.tool.name} with {JSON.stringify(approval.input)}? [y/N] </Text></Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {commandPaletteOpen ? <CommandPalette commands={matchingCommands} selectedIndex={commandIndex} color={config.theme} /> : null}
          <Box paddingX={1} flexDirection="column">
            <Text dimColor>{busy ? 'Koda is thinking' : 'Message Koda'}</Text>
            {busy ? (
              <Text color={config.theme}>Thinking{thinkingFrames[thinkingFrame]}</Text>
            ) : (
              <Box>
                <Text color={config.theme}>› </Text>
                {input ? <Text>{input}</Text> : <Text color="#9ca3af">Type a message or / for commands</Text>}
              </Box>
            )}
          </Box>
          <Text dimColor>{busy ? 'Ctrl+C to cancel' : 'Enter send  ·  Shift+Enter newline  ·  / commands'}</Text>
        </Box>
      )}
    </Box>
  );
}

<div align="center">

# Koda Code

### Your coding agent, right in the terminal.

**Fast · Safe · Extensible · PowerShell friendly**

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://github.com/Lafmine/kodacli/actions/workflows/ci.yml/badge.svg)](https://github.com/Lafmine/kodacli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Koda Code is a clean-room terminal coding agent with an interactive TUI, streaming responses, local development tools, permission controls, persistent sessions, and an extensible provider API. It works offline in demo mode and supports live models through GenAPI.

```text
 ╭──────────────────────────────────────────────────────────────╮
 │ Koda Code                                                    │
 │ C:\projects\my-app · main                                    │
 │ Koda · default                                               │
 ╰──────────────────────────────────────────────────────────────╯

 Message Koda
 › Type a message or / for commands
 Enter send · Shift+Enter newline · / commands
```

## Quick start

Open PowerShell and run one command:

```powershell
irm https://koda-cli.vercel.app/install.ps1 | iex
```

The installer checks Windows, installs Node.js LTS and Git through `winget` when needed, installs Koda globally, and adds it to your user `PATH`. Then open a project folder and run:

```powershell
koda
```

After installation, run `koda` from any project folder. No API setup or model selection is required.

## Uninstall

To remove Koda from a user's computer, open PowerShell and run:

```powershell
npm.cmd uninstall --global koda-code-cli
```

To also delete local Koda config and saved sessions:

```powershell
Remove-Item -LiteralPath "$env:APPDATA\Koda" -Recurse -Force
```

## Highlights

| Feature | What it gives you |
|---|---|
| Interactive terminal | Streaming messages, command palette, history, multiline input, and `Thinking...` state |
| Local coding tools | Read, list, search, write, edit, open files, and run shell commands |
| Permission modes | `default`, read-only `plan`, and trusted `bypass` workflows |
| Workspace safety | Path traversal protection, command timeouts, and bounded output |
| Persistent sessions | Continue work across terminal restarts |
| Provider architecture | Add another streaming LLM without changing the agent loop |
| Windows ready | Designed in PowerShell with cross-platform Node APIs |

## Slash commands

Type `/` to open the searchable command palette.

| Command | Description |
|---|---|
| `/help` | Show commands and shortcuts |
| `/clear` | Clear the visible conversation |
| `/status` | Show session and workspace status |
| `/config` | Show active configuration |
| `/permissions` | Cycle `default`, `plan`, and `bypass` |
| `/resume` | Resume the latest workspace session |
| `/new` | Start a new session |
| `/exit` | Exit Koda |

Use `↑`/`↓` to select, `Tab` to complete, `Enter` to run, and `Esc` to close the palette.

## API

The public test API configuration is already built in. Users do not need to create `.env`, paste a key, or select a model.

Developers can still override the bundled configuration with `KODA_API_KEY`, `KODA_MODEL`, and `KODA_BASE_URL`. Set `KODA_PROVIDER=demo` to use the offline provider during development.

Private local model instructions can be stored in `sysprm.txt` (or the legacy `systempromt.txt`) in the active workspace. Koda loads the file as the system prompt at runtime; both filenames are ignored by Git and never included in the package.

## Permission modes

- **default** — reads run immediately; writes and shell commands ask first.
- **plan** — analysis and reads are allowed; mutations and shell are blocked.
- **bypass** — tools run without confirmation; workspace protection remains active.

```powershell
koda --permission-mode plan
```

## CLI reference

```text
koda [prompt]
  -p, --print                    print without opening the TUI
  -c, --continue                 continue the latest workspace session
  -s, --session <id>             resume a session by ID
      --permission-mode <mode>   default, plan, or bypass
      --cwd <path>               select the workspace
  -V, --version
  -h, --help
```

## Local development

```powershell
git clone https://github.com/Lafmine/kodacli.git
cd kodacli
npm install
npm test
npm run dev
```

The codebase separates providers, the agent loop, tools, permissions, sessions, configuration, and Ink UI. A provider implements `ChatProvider.stream()` and yields text, tool-call, usage, error, and completion events.

## Security

- `.env` and `.koda.json` are ignored by Git.
- Published package files are restricted to `dist`, `README.md`, and `LICENSE`.
- File tools resolve real paths and cannot leave the workspace.
- API keys are environment-only and redacted from provider errors.
- Non-interactive mode rejects actions that require approval.

Never commit or share an API key. Revoke exposed keys immediately.

## License

MIT © 2026 Lafmine. Koda is an original clean-room implementation and contains no leaked or proprietary source code from other coding agents.

<div align="center">

Built with TypeScript, React, Ink, and a little terracotta `#d97757`.

</div>

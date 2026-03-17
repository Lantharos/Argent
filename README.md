# OpenSmith

OpenSmith is a desktop coding workspace built with Electron, React, and TypeScript. It combines an AI chat surface, file editor, terminal, browser, and Git tooling into one release-oriented app shell.

![OpenSmith preview](./preview.png)

## Status

OpenSmith is currently pre-release software and the project is still moving quickly.

This repository is Windows-first today. The codebase includes cross-platform pieces such as Electron and `node-pty`, but macOS and Linux are not currently verified by the maintainer, so those platforms should be treated as experimental until tested by contributors.

## What It Does

- Project spaces backed by local folders
- AI chat tab with streaming responses, model selection, modes, slash commands, and file/image attachments
- Built-in editor with file tree, drag-and-drop file moves, save shortcuts, and tab opening
- Integrated terminal sessions powered by `node-pty` and `xterm.js`
- Built-in browser tab using Electron `webview`
- Git tab for status, staging, diffs, commit history, remotes, and sync actions
- Split-pane workspaces and persistent app state between launches

## Current AI Support

This build currently supports OpenCode ACP in practice.

The codebase contains some compatibility scaffolding for other providers, but the shipped request path currently restricts assistant requests to the built-in `opencode-acp` provider. The README intentionally documents what works now rather than what may arrive later.

## Tech Stack

- Electron
- React 19
- TypeScript
- Vite
- Bun
- Tailwind CSS v4
- CodeMirror 6
- xterm.js
- `node-pty`

## Requirements

- [Bun](https://bun.sh/)
- [Git](https://git-scm.com/) for the Git tab and repository operations
- [OpenCode CLI](https://opencode.ai/) in `PATH` if you want AI chat to work

## Getting Started

```bash
bun install
```

### Run The Full Desktop App

```bash
bun run dev:desktop
```

This starts Vite and Electron together, which is the main development workflow.

### Run Renderer-Only

```bash
bun run dev
```

This is useful for frontend work, but Electron-only features such as the filesystem bridge, terminal, Git actions, and AI bridge will not behave like the packaged desktop app.

## Build And Launch

```bash
bun run build
bun run start:desktop
```

`bun run build` creates the renderer bundle in [`dist`](./dist). `bun run start:desktop` launches Electron against that built bundle.

At the moment, this repository does not include installer or distributable packaging scripts yet. It builds the app assets, but not a signed release package.

## Project Structure

```text
.
|- electron/        Electron main process, IPC, providers, terminal, and Git handlers
|- public/          Static assets
|- src/             React renderer and tab UI
|- dist/            Vite build output
`- .github/         Issue templates
```

## Notes On Platform Support

- Windows is the primary environment used during development.
- macOS support is unverified.
- Linux support is unverified.
- If you test and fix platform-specific issues, those contributions are especially valuable.

## Data And Configuration

OpenSmith stores app state and provider data under Electron's user data directory in an `opensmith` subfolder. That includes:

- persisted workspace state
- provider configuration
- encrypted secrets when Electron `safeStorage` is available on the host system

## Contributing

Contributions are appreciated, especially as the project gets ready for release, but contribution does not guarantee review, feedback, or merge.

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## Security

If you find a security issue, please read [SECURITY.md](./SECURITY.md) before reporting it.

## License

MIT
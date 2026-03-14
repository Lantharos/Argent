# OpenSmith

> An AI-powered developer environment for the modern era.

OpenSmith is an Electron-based IDE that brings together code editing, terminal, browser, and AI assistance into a unified workspace. Think of it as your all-in-one development environment with deep AI integration.

## Features

### Multi-Tab Workspace
- **AI Tab** - Chat with AI assistants, get code suggestions, and more
- **Editor Tab** - Full-featured code editor with syntax highlighting
- **Terminal Tab** - Integrated terminal powered by xterm.js
- **Browser Tab** - Built-in web browser for documentation and research

### Multi-Provider AI Support
OpenSmith isn't tied to a single AI provider. Use whatever works best for you:

- **GitHub Copilot** - Official Copilot integration via `@github/copilot-sdk`
- **OpenAI Codex** - Native integration with OpenAI's Codex CLI
- **OpenCode ACP** - Integration with OpenCode's ACP protocol
- **OpenAI Compatible** - Connect to any OpenAI-compatible API (OpenAI, Anthropic, Google, local models, etc.)

### Modern Architecture
- **Electron** - Cross-platform desktop app foundation
- **React 19** - UI framework with latest features
- **TypeScript** - Type-safe codebase
- **Vite** - Fast build tooling
- **Bun** - JavaScript runtime and package manager
- **CodeMirror 6** - Modern code editor
- **xterm.js** - Terminal emulator
- **Tailwind CSS v4** - Utility-first styling
- **electron-store** - Persistent configuration storage
- **node-pty** - Native terminal support

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) - JavaScript runtime (required)
- [Electron](https://electronjs.org) - Desktop framework (auto-installed)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli) - Optional, for Copilot integration
- [OpenAI Codex](https://openai.com/codex) - Optional, for Codex integration
- [OpenCode](https://opencode.ai) - Optional, for OpenCode integration

### Installation

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

### Building

```bash
# Build for production
bun run build

# The built app will be in the dist/ folder
```

## Project Structure

```
opensmith/
├── electron/           # Electron main process code
│   ├── ai/            # AI provider integrations
│   ├── store/         # Persistent storage
│   └── ...
├── src/               # React renderer (frontend)
│   ├── components/    # UI components
│   ├── hooks/         # React hooks
│   ├── stores/        # State management
│   ├── types/         # TypeScript types
│   └── ...
├── public/            # Static assets
├── dist/              # Build output
└── ...
```

## Configuration

OpenSmith stores its configuration locally using `electron-store`. Configuration includes:
- AI provider settings (API keys, endpoints)
- UI preferences
- Window state (size, position)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT

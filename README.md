# Command Center

Personal Claude assistant via WhatsApp. Runs in isolated Docker containers.

## Requirements

- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Docker](https://docker.com/products/docker-desktop)

## Setup

```bash
git clone git@github.com:IllyaMoore/Command-Center.git
cd Command-Center
npm install
claude
```

Then run `/setup` in Claude Code.

## Usage

Message your assistant with trigger word (default: `@Andy`):

```
@Andy what's my schedule for today?
@Andy send me a summary of unread emails every morning at 9am
@Andy research this topic and save notes
```

From main channel (self-chat) you can manage groups:

```
@Andy list all scheduled tasks
@Andy join the Family Chat group
@Andy show registered groups
```

## Key Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Run with hot reload |
| `npm run build` | Compile TypeScript |
| `/setup` | Initial setup in Claude Code |
| `/debug` | Troubleshoot issues |
| `/customize` | Add features or change behavior |

## Structure

```
src/
├── index.ts           # Main orchestrator
├── channels/
│   └── whatsapp.ts    # WhatsApp connection
├── container-runner.ts # Docker execution
├── db.ts              # SQLite database
└── ...

groups/
├── ceo/CLAUDE.md      # Admin channel memory
├── global/CLAUDE.md   # Shared memory
└── {group}/CLAUDE.md  # Per-group memory
```

## Configuration

No config files. Tell Claude Code what you want:

- "Change trigger word to @Bob"
- "Make responses shorter"
- "Add Gmail integration" or run `/add-gmail`

## Secrets

Create `.env` file (never commit):

```env
ANTHROPIC_API_KEY=sk-ant-...
```

## License

MIT

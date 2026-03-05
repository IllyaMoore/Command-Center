# Session Management Help

Display available session commands and usage.

## Instructions

Show the following help text:

```
Session Management Commands:

  /project:session-start [name]   Start a new session (optional name)
  /project:session-update [note]  Log progress update (optional note)
  /project:session-end [note]     End session with full report
  /project:session-current        Show active session status
  /project:session-list           List all sessions
  /project:session-help           Show this help

Workflow:
  1. Start a session:  /project:session-start feature-auth
  2. Work on your code...
  3. Log updates:      /project:session-update added login endpoint
  4. End with report:  /project:session-end ready for review

Sessions are stored in .claude/sessions/ as markdown files.
Reports include: files changed, technologies used, commits,
decisions made, problems solved, and remaining work.
```

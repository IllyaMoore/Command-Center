# Current Session Status

Show the status of the active development session.

## Instructions

1. Read `.claude/sessions/.current-session`. If empty, tell the user no active session exists and suggest `/project:session-start`.

2. Read the active session file.

3. Display a concise summary:
   - Session name and start time
   - Time elapsed since start
   - Current branch
   - Number of updates logged
   - Last update summary (if any)
   - Quick git status (changed files count)

4. Remind user of available commands: `/project:session-update`, `/project:session-end`.

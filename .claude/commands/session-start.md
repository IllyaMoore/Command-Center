# Start Development Session

Begin a new development session. Create a session file and track progress.

## Instructions

1. Create a new markdown file in `.claude/sessions/` with the naming pattern: `YYYY-MM-DD-HHMM-$ARGUMENTS.md` (use the current date/time). If no arguments provided, use just `YYYY-MM-DD-HHMM.md`.

2. Write the following structure to the session file:

```markdown
# Session: [name or date]

## Overview
- **Started**: [current datetime]
- **Branch**: [current git branch]
- **Base commit**: [current HEAD short hash]

## Goals
- [Ask user for session goals, or note "Goals to be defined"]

## Progress
<!-- Updates will be appended here -->

## Files Changed
<!-- Tracked automatically -->

## Technologies & Tools
<!-- Tracked automatically -->
```

3. Write the session filename to `.claude/sessions/.current-session`

4. Run `git status` and `git log --oneline -5` to capture starting state.

5. Confirm the session has started and remind user of available commands:
   - `/project:session-update` — log progress
   - `/project:session-end` — end session with full report
   - `/project:session-current` — check active session

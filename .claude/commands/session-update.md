# Update Development Session

Append a progress update to the active session.

## Instructions

1. Read `.claude/sessions/.current-session` to find the active session file. If empty, tell the user to start a session first with `/project:session-start`.

2. Gather current state:
   - Run `git diff --stat` to see changed files
   - Run `git log --oneline -3` for recent commits
   - Note the current branch

3. Append a new update entry to the session file under `## Progress`:

```markdown
### Update [HH:MM]
- **Summary**: [user-provided note or auto-generated from git diff]
- **Files modified**: [list from git diff --stat]
- **Branch**: [current branch]
- **Recent commits**: [from git log]
- **Notes**: $ARGUMENTS
```

4. Keep the update concise but comprehensive. If the user provided `$ARGUMENTS`, use that as the summary. Otherwise, auto-generate from git changes.

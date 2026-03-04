# List All Sessions

Display all recorded development sessions.

## Instructions

1. Check if `.claude/sessions/` directory exists. If not, inform the user.

2. List all `.md` files in `.claude/sessions/` (exclude hidden files like `.current-session`).

3. For each session file:
   - Extract the title (first `#` heading)
   - Extract the start date/time from the Overview section
   - Show whether it's the currently active session (check `.current-session`)

4. Display in reverse chronological order (newest first):

```
Sessions:
  * 2026-03-04-1430-infra-setup.md — "Infra Setup" (active)
    2026-03-03-0900-dashboard-fix.md — "Dashboard Fix"
    2026-03-01-1100.md — "Session: 2026-03-01"
```

5. Show total session count.

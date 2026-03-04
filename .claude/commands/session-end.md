# End Development Session — Full Report

Generate a comprehensive session report and close the active session.

## Instructions

1. Read `.claude/sessions/.current-session` to find the active session. If empty, tell the user no active session exists.

2. Read the full session file to understand what happened.

3. Gather final state:
   - `git diff --stat [base_commit]..HEAD` — all changes since session start
   - `git log --oneline [base_commit]..HEAD` — all commits
   - `git diff --stat` — any uncommitted changes
   - `git branch --show-current`

4. Append to the session file a complete report:

```markdown
## Session Report

### Summary
[2-3 sentence overview of what was accomplished]

### Duration
- **Started**: [from overview]
- **Ended**: [current datetime]

### Commits
[List all commits made during session]

### Files Changed
| File | Action | Lines +/- |
|------|--------|-----------|
[Table of all files modified/created/deleted with line counts]

### Technologies & Tools Used
- **Languages**: [e.g., TypeScript, Bash, HCL]
- **Frameworks/Libraries**: [e.g., Node.js, Vitest, Terraform]
- **Tools**: [e.g., Docker, git, npm, Claude Agent SDK]
- **Services**: [e.g., AWS, GitHub Actions, Linear]
- **Patterns**: [e.g., IPC, cron scheduling, container orchestration]

### Key Decisions
[List architectural or implementation decisions made and why]

### Problems Encountered & Solutions
[List any issues hit and how they were resolved]

### Dependencies Changed
[Any packages added/removed/updated, or note "None"]

### Remaining Work
[Any tasks left incomplete or follow-ups needed]

### Linear Issues
[Any Linear issues referenced or worked on, or note "None"]

### Notes
$ARGUMENTS
```

5. Clear `.claude/sessions/.current-session` (make it empty).

6. Display the full report to the user.

7. The report should be detailed enough that another developer (or AI) can understand everything that happened without reviewing the conversation history.

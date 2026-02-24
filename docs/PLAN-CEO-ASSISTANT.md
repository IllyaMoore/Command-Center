# Implementation Plan: CEO Executive Assistant

## Current Status

### Already Implemented
- [x] Gmail MCP server configured (`@gongrzhe/server-gmail-autoauth-mcp`)
- [x] Gmail tools allowed (`mcp__gmail__*`)
- [x] `~/.gmail-mcp` mount in container-runner.ts
- [x] Calendar MCP server configured (`@gongrzhe/server-google-calendar-mcp`)
- [x] Calendar tools allowed (`mcp__calendar__*`)
- [x] `~/.google-calendar-mcp` mount ready in container-runner.ts
- [x] Basic CEO CLAUDE.md with briefing formats
- [x] Fireflies (via Gmail - no separate integration needed)

### Not Implemented
- [ ] Google Calendar OAuth credentials setup
- [ ] Gmail OAuth credentials verification
- [ ] CEO CLAUDE.md - full role context and organizations
- [ ] End-to-end testing

---

## Implementation Tasks

### Task 1: Google Calendar OAuth Setup
**Priority: High**

1. Create GCP project (or use existing)
2. Enable Google Calendar API
3. Create OAuth 2.0 credentials (Desktop app type)
4. Download `credentials.json`
5. Run first-time auth to generate tokens:
   ```bash
   npx -y @gongrzhe/server-google-calendar-mcp
   ```
6. Verify `~/.google-calendar-mcp/` contains tokens

**Files:** None (external setup)

---

### Task 2: Gmail OAuth Verification
**Priority: High**

1. Verify `~/.gmail-mcp/` exists with valid tokens
2. If not, run first-time auth:
   ```bash
   npx -y @gongrzhe/server-gmail-autoauth-mcp
   ```
3. Test email search works

**Files:** None (external setup)

---

### Task 3: Enhance CEO CLAUDE.md
**Priority: Medium**

Add to `groups/ceo/CLAUDE.md`:
- Full role description
- Organizations/companies context
- Key contacts
- Priorities and responsibilities
- Scheduled task examples

**Files:** `groups/ceo/CLAUDE.md`

---

### Task 4: Register CEO Group
**Priority: High**

Add CEO group to `data/registered_groups.json` with:
- WhatsApp JID
- Folder: `ceo`
- Trigger word

**Files:** `data/registered_groups.json`

---

### Task 5: Create Daily Briefing Scheduled Task
**Priority: Medium**

From main channel, create scheduled task:
```
@Andy schedule a task for the CEO group: every weekday at 8:00 AM,
send a daily briefing with today's calendar events and unread emails
```

**Files:** Database (scheduled_tasks table)

---

### Task 6: End-to-End Testing
**Priority: High**

Test commands from CEO group:
1. "What's on my calendar today?"
2. "Show unread emails from this week"
3. "What meetings do I have tomorrow?"
4. "Search for emails from [contact]"

**Expected:** Real data from Google Calendar and Gmail

---

## Definition of Done

- [ ] Agent responds to "what's on my calendar today" with real events
- [ ] Agent responds to "show unread emails" with real emails
- [ ] Daily briefing scheduled task runs at 8 AM
- [ ] Fireflies meeting recaps searchable via Gmail

---

## Notes

### MCP Server Packages
- Gmail: `@gongrzhe/server-gmail-autoauth-mcp`
- Calendar: `@gongrzhe/server-google-calendar-mcp`

### Credential Locations
- Gmail: `~/.gmail-mcp/`
- Calendar: `~/.google-calendar-mcp/`

### Container Mounts (already in code)
```typescript
// src/container-runner.ts lines 171-181
for (const credDir of ['.gmail-mcp', '.google-calendar-mcp']) {
  const hostPath = path.join(homeDir, credDir);
  if (fs.existsSync(hostPath)) {
    mounts.push({
      hostPath,
      containerPath: `/home/node/${credDir}`,
      readonly: false,
    });
  }
}
```

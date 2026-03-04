# Daily Standup Scheduler

Compose and schedule a standup message for #storyfunnels based on Linear tasks.

Trigger: "standup", "daily standup", "schedule standup"

## Instructions

Run all steps automatically. Only pause to show the draft for approval.

### 1. Gather Context

**In parallel:**

a) Read last 10 messages from #storyfunnels to see recent standups and what was planned:
   - Channel ID: `C09RPL4A8MQ`
   - Use `slack_read_channel` with limit 10
   - Find the last message from illia (user ID `U0A0SV736EB`) — this is the previous standup

b) Get active Linear issues assigned to me:
   - Use `list_issues` with `assignee: "me"`
   - Filter to **not Done/Cancelled** — keep only: In Progress, In Review, Todo, Backlog

### 2. Analyze

From the previous standup, identify:
- What was listed as "today's plan" — these become **yesterday's accomplishments** in the new standup

From Linear issues, determine:
- **In Progress** and **In Review** tasks = likely worked on recently (yesterday)
- **Next priority tasks** = what to work on today (prefer In Progress > Todo by priority)

### 3. Compose Message

Use this exact format (illia's style):

```
• [TICKET-ID]([short task description]), [TICKET-ID]([short description])
• [TICKET-ID]([next task description])
• No blockers
```

Rules:
- Line 1: Yesterday — tasks worked on (from previous standup's "today" + In Review items)
- Line 2: Today — planned tasks (highest priority active items)
- Line 3: Blockers (default "No blockers" unless user specifies)
- Use bullet character `•` (not `-`)
- Keep descriptions short (3-7 words)
- Always include ticket ID with description in parentheses
- If a task moved to "In Review", mention it as "in review" or "review"

### 4. Show Draft

Present the composed message to the user:

> **Standup draft for [target date]:**
>
> [message]
>
> Schedule to #storyfunnels at 12:15 IST?

Wait for user approval. They may want to edit the text or add blockers.

### 5. Calculate Target Date and Schedule

**Determine next workday:**
- Monday through Thursday → next day
- Friday → Monday (+3 days)
- Saturday → Monday (+2 days)
- Sunday → Monday (+1 day)

**Calculate schedule time:**
- Target: 12:15 on the next workday in Asia/Jerusalem timezone
- Use ISO 8601 format: `YYYY-MM-DDT12:15:00+02:00` (IST winter) or `+03:00` (IDT summer)
- Israel DST starts last Friday of March, ends last Sunday of October

**Schedule the message:**
- Use `slack_schedule_message`
- Channel: `C09RPL4A8MQ`
- Post the final approved message text

Confirm to user with the scheduled date and time.

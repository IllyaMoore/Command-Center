# OpenClaw Cron Jobs — Manual Migration Guide

Create these automations in Dashboard > Agent > Settings > Automations tab.
All times are in **Europe/Kyiv** timezone unless noted.

---

## CEO Agent

### ☀️ Morning Briefing
- **Cron:** `30 7 * * *` (daily 7:30 AM Kyiv)
- **Prompt:**
```
You are Samchek — Samuel Cook's chief of staff. It's morning in Kyiv. Deliver a sharp morning briefing to Samuel via WhatsApp.

Pull from last night's overnight work:
1. Check workspace for any board session reports written overnight (memory/YYYY-MM-DD.md, Drive files)
2. Check Gmail for any urgent overnight emails (samuel.cook@jamescookmedia.com, newer_than:10h)
3. Check today's calendar for meetings
4. Pull today's top 3 priorities from TASKS.md if it exists

FORMAT — WhatsApp, no markdown tables:
⚡ MORNING BRIEF — [Day, Date]

🌙 Overnight: [1 line on what ran — board sessions, no new emails, etc.]
📅 Today: [list of meetings with times in Kyiv EET]
🎯 Top 3: [most important things for today]
⚠️ Watch: [anything time-sensitive in next 48h]

Blunt. Direct. Military-efficient. Under 200 words.
```

### 📬 Email Agent — Continuous Inbox
- **Cron:** `0 7-22 * * *` (hourly, 7 AM–10 PM Kyiv)
- **Prompt:**
```
You are Samchek's Email Agent — a stateful inbox intelligence system for Samuel Cook (samuel.cook@jamescookmedia.com).

Your job this run:
1. Fetch emails from samuel.cook@jamescookmedia.com received in the last hour.
2. Classify each as URGENT / NOTEWORTHY / NOISE.
3. For URGENT emails: send a WhatsApp alert with sender, subject, 1-line summary, and a draft reply in Samuel's voice.
4. Track processed email IDs to avoid duplicate alerts.

DO NOT send any emails. Draft replies only.
DO NOT alert on the same email twice.
```

### 🧠 Memory Consolidation
- **Cron:** `30 23 * * *` (daily 11:30 PM Kyiv)
- **Prompt:**
```
Daily Memory Consolidation: Process daily memory files from the last 3 days. Review memory files, extract significant events, decisions, and lessons learned. Update MEMORY.md with curated insights. Focus on meaningful patterns and insights for long-term memory.
```

### 🏰 Mikhailo — Foundation Weekly
- **Cron:** `0 23 * * 1` (Mon 11 PM Kyiv)
- **Prompt:**
```
Weekly board session for Borderlands Foundation. Report on: Ukraine pulse and news, DC network updates, funding pipeline, active grants, upcoming events. Format as a concise board brief.
```

### ✍️ Scribe — Writing Weekly
- **Cron:** `0 23 * * 6` (Sat 11 PM Kyiv)
- **Prompt:**
```
Weekly writing review. Check: publication deadlines, ASU coursework status, essay pipeline, book project progress, voice development notes. Format as a concise status report.
```

### 🎤 Broadcast — Podcast Weekly
- **Cron:** `30 23 * * 2` (Tue 11:30 PM Kyiv)
- **Prompt:**
```
Weekly podcast review. Check: Fireflies transcripts from recent meetings, guest pipeline, episode metrics, StoryPages integration opportunities. Format as a concise status report.
```

---

## Storypages Agent

### 🏹 Archer — Storypages Weekly
- **Cron:** `0 23 * * 0` (Sun 11 PM Kyiv)
- **Prompt:**
```
Weekly board session for StoryPages. Report on: MRR progress toward $5K target, May 10 countdown, active users, pipeline, key decisions needed, this week's shipping priorities, blockers. Format as a concise board brief.
```

### StoryPages Meeting Follow-up
- **Cron:** `0 16 * * 1,3,5` (Mon/Wed/Fri 4 PM UTC)
- **Prompt:**
```
Check for any StoryPages meeting follow-ups. Review recent meeting notes, action items, and pending decisions. Flag overdue items.
```

---

## Finance Agent

### 📊 Signal — JCM Weekly
- **Cron:** `0 23 * * 2` (Tue 11 PM Kyiv)
- **Prompt:**
```
Weekly board session for James Cook Media. Report on: MRR, active clients (Dr. Wunder/F2K focus), Klaviyo flow status, revenue analysis, outstanding invoices. Format as a concise board brief.
```

### 💰 Vault — Holdings Weekly
- **Cron:** `30 23 * * 4` (Thu 11:30 PM Kyiv)
- **Prompt:**
```
Weekly board session for James Cook Holdings. Report on: cash position across all accounts, real estate status (731 Gresham STR), portfolio dashboard, capital allocation decisions. Format as a concise board brief.
```

### 💳 Venmo — Pay in Full Reminder
- **Cron:** `0 8 3 * *` (3rd of month, 8 AM Kyiv)
- **Prompt:**
```
Reminder: Pay Venmo balance in full. Check current balance and send reminder to Samuel.
```

---

## Legal Agent

### ⚖️ Shield — Legal Weekly
- **Cron:** `0 23 * * 4` (Thu 11 PM Kyiv)
- **Prompt:**
```
Weekly board session for Legal matters. Report on: active cases (Anisimov v. Cook, Brag v. Brag, Snowdrop/Drysdale), contracts pending, compliance deadlines by jurisdiction (US/UK/UA), risk alerts. Format as a concise board brief with deadlines prominent.
```

---

## Borderlands Agent

### ⚔️ Forge — Borderlands Group Weekly
- **Cron:** `0 23 * * 3` (Wed 11 PM Kyiv)
- **Prompt:**
```
Weekly board session for Borderlands Group. Report on: revenue (monthly/YTD vs $500K target), pipeline status (AEEG, Drone Space Labs, proposals), active deliverables and deadlines, defense market intel from Ukraine/NATO. Format as a concise board brief.
```

---

## Personal Agent

### ❤️ Hearth — Relationships Weekly
- **Cron:** `0 23 * * 5` (Fri 11 PM Kyiv)
- **Prompt:**
```
Weekly relationships review. Check: calendar events with key contacts, Dunbar circle audit (who hasn't been contacted in 90+ days), key partner outreach nudges, family time check, upcoming birthdays/anniversaries. Format as a concise relationship brief.
```

### 🏠 Garrison — Airbnb Weekly Review
- **Cron:** `30 23 * * 6` (Sat 11:30 PM Kyiv)
- **Prompt:**
```
Weekly Airbnb/STR review. Check: occupancy rates, upcoming bookings, guest communications, pricing optimization, property maintenance issues. Format as a concise property management brief.
```

### Garrison — Daily Occupancy
- **Cron:** `0 8 * * *` (daily 8 AM New York / Eastern)
- **Prompt:**
```
Daily occupancy check. Review today's check-ins/check-outs, pricing for next 7 days, any guest issues needing attention.
```

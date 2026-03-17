// Command Center Dashboard - Client-side JavaScript
// Connects to the Node.js API backend

const API_BASE = '';  // Same origin

// === Theme (runs immediately to prevent flash) ===
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
}

function setTheme(mode) {
  const resolved = mode === 'dark' ? 'dark' : 'light';
  localStorage.setItem('theme', resolved);
  applyTheme(resolved);
  updateThemeToggle(resolved);
  updateThemeIcon(resolved);
}

function cycleTheme() {
  const current = localStorage.getItem('theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function updateThemeToggle(mode) {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  toggle.querySelectorAll('.tt-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.theme === mode);
  });
}

function updateThemeIcon(mode) {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  const icons = { light: '\u2600', dark: '\u263E', auto: '\u25D1' };
  btn.textContent = icons[mode] || icons.auto;
}

// Apply saved theme immediately
(function() {
  let saved = localStorage.getItem('theme') || 'dark';
  if (saved === 'auto') {
    saved = 'dark';
    localStorage.setItem('theme', saved);
  }
  applyTheme(saved);
  updateThemeIcon(saved);
})();

// === State ===
let chatMessages = [];
let activityItems = [];
let calendarEvents = [];
let currentActivityFilter = 'all';
let chatEventSource = null;
let activityEventSource = null;

// === Clock ===
function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
updateClock();
setInterval(updateClock, 30000);

// === Calendar ===
async function loadCalendarEvents(view = 'day') {
  try {
    const res = await fetch(`${API_BASE}/api/calendar/events?view=${view}`);
    const result = await res.json();
    if (result.error) {
      const msg = result.error === 'auth_failed' ? 'Calendar auth expired — re-connect in settings' : 'Calendar unavailable — check credentials';
      document.getElementById('calendarEvents').innerHTML = `<div class="loading">${msg}</div>`;
    } else {
      calendarEvents = result.events ?? result;
      renderCalendarEvents(calendarEvents, view);
    }
  } catch (err) {
    console.error('Failed to load calendar:', err);
    document.getElementById('calendarEvents').innerHTML = '<div class="loading">Failed to load calendar</div>';
  }
}

function renderCalendarEvents(events, view) {
  if (view === 'week') {
    renderWeekView(events);
    return;
  }

  const container = document.getElementById('calendarEvents');
  if (events.length === 0) {
    container.innerHTML = '<div class="loading">No events today</div>';
    return;
  }

  // Group events by hour
  const grouped = {};
  events.forEach(event => {
    const start = new Date(event.start);
    const hour = start.getHours();
    if (!grouped[hour]) grouped[hour] = [];
    grouped[hour].push(event);
  });

  let html = '';
  Object.keys(grouped).sort((a, b) => a - b).forEach(hour => {
    const hourEvents = grouped[hour];
    const label = formatHour(parseInt(hour));
    html += `<div class="time-div"><span class="td-label">${label}</span><div class="td-line"></div></div>`;

    hourEvents.forEach(event => {
      const start = new Date(event.start);
      const end = new Date(event.end);
      const duration = Math.round((end - start) / (1000 * 60));
      const color = event.color || 'var(--g)';

      html += `
        <div class="event">
          <div class="event-bar" style="background:${color}"></div>
          <div class="event-body">
            <div class="event-name">${escapeHtml(event.title)}</div>
            <div class="event-meta">
              ${event.location ? `<span>${escapeHtml(event.location)}</span>` : ''}
            </div>
          </div>
          <div class="event-time">${duration}m</div>
        </div>
      `;
    });
  });

  container.innerHTML = html || '<div class="loading">No events today</div>';

  // Update brief
  const brief = document.getElementById('briefContent');
  const eventCount = events.length;
  const totalMins = events.reduce((sum, e) => {
    const start = new Date(e.start);
    const end = new Date(e.end);
    return sum + (end - start) / (1000 * 60);
  }, 0);
  const hours = Math.round(totalMins / 60 * 10) / 10;
  brief.innerHTML = `<strong>${eventCount} events</strong> scheduled. ~${hours}h of meetings.`;
}

function renderWeekView(events) {
  const HOUR_START = 7;   // 7 AM
  const HOUR_END = 21;    // 9 PM
  const isMobile = window.matchMedia('(max-width:767px)').matches;
  const HOUR_HEIGHT = isMobile ? 32 : 52; // compact on mobile
  const totalHours = HOUR_END - HOUR_START;

  // Build week starting from Monday of current week
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today); monday.setDate(today.getDate() + mondayOffset);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }

  const dayLabels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  // Separate all-day vs timed events per day
  const allDayByDay = days.map(() => []);
  const timedByDay = days.map(() => []);

  events.forEach(event => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const dayIdx = days.findIndex(d => start.toDateString() === d.toDateString());
    if (dayIdx === -1) return;
    if (event.allDay) {
      allDayByDay[dayIdx].push(event);
    } else {
      timedByDay[dayIdx].push(event);
    }
  });

  const hasAllDay = allDayByDay.some(arr => arr.length > 0);

  // --- Header row ---
  let html = '<div class="wk-header">';
  html += '<div class="wk-gutter-head"></div>';
  days.forEach((day, i) => {
    const isToday = day.toDateString() === today.toDateString();
    html += `
      <div class="wk-day-head${isToday ? ' wk-today' : ''}">
        <span class="wk-day-label">${dayLabels[i]}</span>
        <span class="wk-day-num">${day.getDate()}</span>
      </div>`;
  });
  html += '</div>';

  // --- All-day row (if any) ---
  if (hasAllDay) {
    html += '<div class="wk-allday-row">';
    html += '<div class="wk-gutter-allday"><span>ALL DAY</span></div>';
    days.forEach((day, i) => {
      const isToday = day.toDateString() === today.toDateString();
      html += `<div class="wk-allday-cell${isToday ? ' wk-today-bg' : ''}">`;
      allDayByDay[i].forEach(event => {
        const color = event.color || 'var(--g)';
        html += `<div class="wk-allday-chip" style="border-left-color:${color}">${escapeHtml(event.title)}</div>`;
      });
      html += '</div>';
    });
    html += '</div>';
  }

  // --- Time grid body ---
  html += `<div class="wk-body-scroll" style="--hour-h:${HOUR_HEIGHT}px">`;
  html += '<div class="wk-body-inner">';

  // Hour gutter
  html += '<div class="wk-gutter">';
  for (let h = HOUR_START; h < HOUR_END; h++) {
    html += `<div class="wk-hour-label">${formatHour(h)}</div>`;
  }
  html += '</div>';

  // Day columns
  days.forEach((day, i) => {
    const isToday = day.toDateString() === today.toDateString();
    html += `<div class="wk-day-col${isToday ? ' wk-today-bg' : ''}">`;

    // Hour grid lines
    for (let h = HOUR_START; h < HOUR_END; h++) {
      html += `<div class="wk-hour-cell"></div>`;
    }

    // Events as positioned blocks
    timedByDay[i].forEach(event => {
      const start = new Date(event.start);
      const end = new Date(event.end);
      const startMins = start.getHours() * 60 + start.getMinutes();
      const endMins = end.getHours() * 60 + end.getMinutes();
      const topMins = startMins - HOUR_START * 60;
      const durMins = Math.max(endMins - startMins, 15); // min 15 min height

      const topPx = (topMins / 60) * HOUR_HEIGHT;
      const heightPx = (durMins / 60) * HOUR_HEIGHT;
      const color = event.color || 'var(--g)';

      const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      html += `
        <div class="wk-event-block" style="top:${topPx}px;height:${heightPx}px;--ev-color:${color}" title="${escapeHtml(event.title)}&#10;${startTime} – ${endTime}${event.location ? '&#10;' + escapeHtml(event.location) : ''}">
          <div class="wk-ev-title">${escapeHtml(event.title)}</div>
          <div class="wk-ev-time">${startTime}</div>
        </div>`;
    });

    // Current time indicator
    if (isToday) {
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const nowOffset = nowMins - HOUR_START * 60;
      if (nowOffset >= 0 && nowOffset <= totalHours * 60) {
        const nowPx = (nowOffset / 60) * HOUR_HEIGHT;
        html += `<div class="wk-now-line" style="top:${nowPx}px"><div class="wk-now-dot"></div></div>`;
      }
    }

    html += '</div>';
  });

  html += '</div></div>';

  document.getElementById('weekView').innerHTML = html;
}

function formatHour(hour) {
  if (hour < 12) return `${hour === 0 ? 12 : hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function calMode(mode, btn) {
  btn.closest('.pane-toggle').querySelectorAll('button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('dayView').classList.toggle('hid', mode !== 'day');
  document.getElementById('weekView').classList.toggle('vis', mode === 'week');
  loadCalendarEvents(mode);
}

// === Activity ===
async function loadActivity() {
  try {
    const res = await fetch(`${API_BASE}/api/activity?limit=50`);
    const items = await res.json();
    activityItems = items;
    renderActivity(items);
    updateAgentStatus(true);
  } catch (err) {
    console.error('Failed to load activity:', err);
    document.getElementById('feedList').innerHTML = '<div class="loading">Failed to load activity</div>';
    updateAgentStatus(false);
  }
}

function renderActivity(items) {
  const container = document.getElementById('feedList');
  const filtered = filterActivityItems(items, currentActivityFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="loading">No recent activity</div>';
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const color = item.type === 'task_run' ? 'var(--bl)' : 'var(--g)';
    const time = formatRelativeTime(new Date(item.timestamp));

    if (item.type === 'task_run') {
      const statusIcon = item.status === 'success' ? '&#10003;' : '&#10007;';
      html += `
        <div class="feed-item" data-ag="task">
          <div class="fi-dot" style="background:${color}"></div>
          <div class="fi-body">
            <div class="fi-text">
              <strong>Task ${statusIcon}</strong> ${escapeHtml((item.task_prompt || '').slice(0, 50))}
              <span class="fi-badge">${item.duration_ms}ms</span>
            </div>
            <div class="fi-time">${time}</div>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="feed-item" data-ag="ceo">
          <div class="fi-dot" style="background:${color}"></div>
          <div class="fi-body">
            <div class="fi-text">
              <strong>${escapeHtml(item.sender_name || 'Message')}</strong> ${escapeHtml((item.content || '').slice(0, 80))}
            </div>
            <div class="fi-time">${time}</div>
          </div>
        </div>
      `;
    }
  });

  container.innerHTML = html;
}

function filterActivityItems(items, filter) {
  if (filter === 'all') return items;
  if (filter === 'task') return items.filter(i => i.type === 'task_run');
  if (filter === 'ceo') return items.filter(i => i.type === 'message');
  return items;
}

function filterAg(ag) {
  currentActivityFilter = ag;
  document.querySelectorAll('.pill').forEach(p => p.classList.toggle('on', p.dataset.ag === ag));
  renderActivity(activityItems);
}

function actMode(mode, btn) {
  btn.closest('.pane-toggle').querySelectorAll('button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  // For now, both modes show the same filtered list
  renderActivity(activityItems);
}

// === Chat ===
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  // Message will appear via SSE once stored in DB

  // Show typing indicator
  document.getElementById('voiceIndicator').classList.add('active');

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const result = await res.json();

    if (!result.success) {
      addChatMessage({ text: `Error: ${result.error}`, sender: 'agent', agentName: 'System', timestamp: new Date().toISOString() });
    }
    // Response will come through SSE
  } catch (err) {
    console.error('Failed to send message:', err);
    addChatMessage({ text: 'Failed to send message. Check connection.', sender: 'agent', agentName: 'System', timestamp: new Date().toISOString() });
  } finally {
    setTimeout(() => {
      document.getElementById('voiceIndicator').classList.remove('active');
    }, 2000);
  }
}

function sendMobileMessage() {
  const input = document.getElementById('mobileChatInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  // Message will appear via SSE once stored in DB

  document.getElementById('mobileVoiceIndicator').classList.add('active');

  fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(err => {
    console.error('Failed to send message:', err);
  }).finally(() => {
    setTimeout(() => {
      document.getElementById('mobileVoiceIndicator').classList.remove('active');
    }, 2000);
  });
}

function addChatMessage(msg, mobileOnly = false) {
  const isUser = msg.sender === 'user';
  const VALID_SOURCES = ['whatsapp', 'telegram', 'dashboard'];
  const source = VALID_SOURCES.includes(msg.source) ? msg.source : null;
  const sourceLabel = source ? `<span class="source-badge source-${source}">${escapeHtml(source)}</span>` : '';
  const html = isUser
    ? `<div class="msg msg-u">${sourceLabel}${escapeHtml(msg.text)}</div>`
    : `<div class="msg msg-a"><div class="agent-label">${escapeHtml(msg.agentName || 'CEO Agent')}</div>${escapeHtml(msg.text)}</div>`;

  if (!mobileOnly) {
    const container = document.getElementById('chatMsgs');
    container.innerHTML += html;
    container.scrollTop = container.scrollHeight;
  }

  const mobileContainer = document.getElementById('mobileMsgs');
  mobileContainer.innerHTML += html;
  mobileContainer.scrollTop = mobileContainer.scrollHeight;
}

function setupChatSSE() {
  if (chatEventSource) {
    chatEventSource.close();
  }

  chatEventSource = new EventSource(`${API_BASE}/api/chat/stream`);

  chatEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'initial') {
        // Clear and render initial messages
        document.getElementById('chatMsgs').innerHTML = '';
        document.getElementById('mobileMsgs').innerHTML = '';
        data.messages.forEach(msg => addChatMessage(msg));
      } else if (data.type === 'update') {
        // Add new messages
        data.messages.forEach(msg => addChatMessage(msg));
      }
    } catch (err) {
      // Heartbeat or parse error, ignore
    }
  };

  chatEventSource.onerror = () => {
    console.warn('Chat SSE connection error, will retry...');
  };
}

function setupActivitySSE() {
  if (activityEventSource) {
    activityEventSource.close();
  }

  activityEventSource = new EventSource(`${API_BASE}/api/activity/stream`);

  activityEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'initial') {
        activityItems = data.items;
        renderActivity(activityItems);
      } else if (data.type === 'update') {
        // Prepend new items
        activityItems = [...data.items, ...activityItems].slice(0, 100);
        renderActivity(activityItems);
      }
    } catch (err) {
      // Heartbeat or parse error, ignore
    }
  };

  activityEventSource.onerror = () => {
    console.warn('Activity SSE connection error, will retry...');
  };
}

// === UI Helpers ===
function updateAgentStatus(online) {
  const status = online ? 'Online' : 'Offline';
  document.getElementById('agentStatus').textContent = status;
  document.getElementById('agentStatusSetting').textContent = status;
}

function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === Navigation ===
function tabletTab(view, btn) {
  btn.closest('.tb-tabs').querySelectorAll('button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('calPane').classList.toggle('tablet-hide', view === 'act');
  document.getElementById('actPane').classList.toggle('tablet-show', view === 'act');
}

function mobileNav(view, btn) {
  document.querySelectorAll('.mn-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('calPane').classList.toggle('mobile-hide', view === 'act');
  document.getElementById('actPane').classList.toggle('mobile-show', view === 'act');
}

function openMobileChat() {
  document.getElementById('mobileChatOverlay').classList.add('open');
  document.getElementById('mobileChatPanel').classList.add('open');
  const msgs = document.getElementById('mobileMsgs');
  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('mobileChatInput').focus();
}

function closeMobileChat() {
  document.getElementById('mobileChatOverlay').classList.remove('open');
  document.getElementById('mobileChatPanel').classList.remove('open');
}

function openSettings() {
  document.getElementById('settingsOverlay').classList.add('open');
  checkGoogleCalendarStatus();
  loadTimezone();
  updateThemeToggle(localStorage.getItem('theme') || 'dark');
}

async function loadTimezone() {
  const select = document.getElementById('tzSelect');
  if (select.options.length === 0) {
    // Populate timezone list once
    const zones = Intl.supportedValuesOf('timeZone');
    zones.forEach(tz => {
      const opt = document.createElement('option');
      opt.value = tz;
      opt.textContent = tz.replace(/_/g, ' ');
      select.appendChild(opt);
    });
  }
  try {
    const res = await fetch(`${API_BASE}/api/settings/timezone`);
    const data = await res.json();
    select.value = data.timezone;
  } catch (err) {
    console.error('Failed to load timezone:', err);
  }
}

async function saveTimezone(tz) {
  try {
    const res = await fetch(`${API_BASE}/api/settings/timezone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: tz })
    });
    const data = await res.json();
    if (!data.success) {
      console.error('Failed to save timezone:', data.error);
    }
  } catch (err) {
    console.error('Failed to save timezone:', err);
  }
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
}

// Shared helper: update a status element + connect button based on OAuth status
function applyAuthStatus(statusElId, btnElId, status, notifications) {
  const el = document.getElementById(statusElId);
  const btn = document.getElementById(btnElId);

  if (status === 'connected') {
    el.textContent = 'Connected';
    if (btn) btn.style.display = 'none';
    if (notifications?.onConnected) notifications.onConnected();
  } else if (status === 'expired') {
    el.textContent = 'Token expired';
    if (btn) { btn.style.display = 'inline-block'; btn.textContent = 'Reconnect'; }
    if (notifications?.onExpired) showNotification(notifications.onExpired);
  } else if (status === 'missing_tokens') {
    el.textContent = 'Not authorized';
    if (btn) { btn.style.display = 'inline-block'; btn.textContent = 'Connect'; }
    if (notifications?.onMissing) showNotification(notifications.onMissing);
  } else if (status === 'check_failed') {
    el.textContent = 'Check failed';
    if (btn) { btn.style.display = 'inline-block'; btn.textContent = 'Reconnect'; }
  } else {
    el.textContent = 'Not configured';
    if (btn) btn.style.display = 'none';
  }
}

async function checkGoogleCalendarStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/google-calendar/status`);
    const data = await res.json();
    applyAuthStatus('gcalStatus', 'gcalConnectBtn', data.status, {
      onConnected: dismissNotification,
      onExpired: 'Google Calendar token expired. Reconnect in Settings.',
      onMissing: 'Google Calendar not connected. Set up in Settings.',
    });
  } catch {
    document.getElementById('gcalStatus').textContent = 'Error';
  }
}

async function checkGmailStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/gmail/status`);
    const data = await res.json();
    applyAuthStatus('gmailStatus', 'gmailConnectBtn', data.status, {
      onExpired: 'Gmail token expired. Reconnect in Settings.',
    });
  } catch {
    document.getElementById('gmailStatus').textContent = 'Error';
  }
}

async function checkGoogleSheetsStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/google-sheets/status`);
    const data = await res.json();
    applyAuthStatus('gsheetsStatus', 'gsheetsConnectBtn', data.status, {
      onExpired: 'Google Sheets token expired. Reconnect in Settings.',
      onMissing: 'Google Sheets not connected. Set up in Settings.',
    });
  } catch {
    document.getElementById('gsheetsStatus').textContent = 'Error';
  }
}

// Shared helper: open OAuth popup and refresh status on success
function connectOAuthProvider(authPath, windowName, messageId, onSuccess) {
  window.open(authPath, windowName, 'width=500,height=700');
  window.addEventListener('message', function handler(e) {
    if (e.data === messageId) {
      window.removeEventListener('message', handler);
      onSuccess();
    }
  });
}

function connectGoogleCalendar() {
  connectOAuthProvider('/api/auth/google-calendar', 'gcal-auth', 'gcal-connected', () => {
    checkGoogleCalendarStatus();
    loadCalendarEvents('day');
  });
}

function connectGmail() {
  connectOAuthProvider('/api/auth/gmail', 'gmail-auth', 'gmail-connected', checkGmailStatus);
}

function connectGoogleSheets() {
  connectOAuthProvider('/api/auth/google-sheets', 'gsheets-auth', 'gsheets-connected', checkGoogleSheetsStatus);
}

function showNotification(text) {
  const bar = document.getElementById('notificationBar');
  document.getElementById('notificationText').textContent = text;
  bar.style.display = 'flex';
}

function dismissNotification() {
  document.getElementById('notificationBar').style.display = 'none';
}

// === Input handlers ===
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    sendMessage();
  }
});

document.getElementById('mobileChatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    sendMobileMessage();
  }
});

// === Initialize ===
// Set today's date on calendar pane header (used by mobile.css)
(function setMobileDate() {
  const head = document.querySelector('.cal-pane .pane-head');
  if (head) {
    const d = new Date();
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    head.setAttribute('data-mobile-date', d.toLocaleDateString('en-US', opts));
  }
})();

async function init() {
  // Check API health
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) {
      updateAgentStatus(true);
    }
  } catch (err) {
    updateAgentStatus(false);
  }

  // Check integrations status
  checkGoogleCalendarStatus();
  checkGmailStatus();
  checkGoogleSheetsStatus();

  // Load initial data
  await Promise.all([
    loadCalendarEvents('day'),
    loadActivity()
  ]);

  // Setup SSE for real-time updates
  setupChatSSE();
  setupActivitySSE();
}

// Start
init();

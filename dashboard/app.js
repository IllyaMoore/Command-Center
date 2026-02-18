// Command Center Dashboard - Client-side JavaScript
// Connects to the Node.js API backend

const API_BASE = '';  // Same origin

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
    const events = await res.json();
    calendarEvents = events;
    renderCalendarEvents(events, view);
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let html = '<div class="wk-grid">';
  days.forEach((day, i) => {
    const isToday = i === 0;
    const dayEvents = events.filter(e => {
      const start = new Date(e.start);
      return start.toDateString() === day.toDateString();
    });

    html += `
      <div class="wk-col${isToday ? ' today' : ''}">
        <div class="wk-head">
          <div class="wd">${dayNames[day.getDay()]}</div>
          <div class="wn">${day.getDate()}</div>
          <div class="wh">${dayEvents.length} events</div>
        </div>
        <div class="wk-body">
    `;

    dayEvents.forEach(event => {
      const start = new Date(event.start);
      const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      html += `
        <div class="wk-event">
          <span class="wk-et">${time}</span>
          ${escapeHtml(event.title.slice(0, 20))}
        </div>
      `;
    });

    html += '</div></div>';
  });
  html += '</div>';

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
  addChatMessage({ text, sender: 'user', timestamp: new Date().toISOString() });

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
  addChatMessage({ text, sender: 'user', timestamp: new Date().toISOString() }, true);

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
  const html = isUser
    ? `<div class="msg msg-u">${escapeHtml(msg.text)}</div>`
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
  document.getElementById('mobileChatInput').focus();
}

function closeMobileChat() {
  document.getElementById('mobileChatOverlay').classList.remove('open');
  document.getElementById('mobileChatPanel').classList.remove('open');
}

function openSettings() {
  document.getElementById('settingsOverlay').classList.add('open');
  checkGoogleCalendarStatus();
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
}

async function checkGoogleCalendarStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/calendar/events?view=day`);
    const events = await res.json();
    document.getElementById('gcalStatus').textContent = events.length >= 0 ? 'Connected' : 'Error';
  } catch {
    document.getElementById('gcalStatus').textContent = 'Not connected';
  }
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
async function init() {
  console.log('Initializing Command Center Dashboard...');

  // Check API health
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) {
      console.log('API connected');
      updateAgentStatus(true);
    }
  } catch (err) {
    console.warn('API not available:', err);
    updateAgentStatus(false);
  }

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

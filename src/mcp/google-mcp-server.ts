/**
 * Google MCP HTTP Server — Drive, Sheets, Gmail, Calendar
 *
 * Implements MCP Streamable HTTP transport (JSON-RPC 2.0) as a single endpoint
 * on the dashboard server. Replaces npm MCP packages with direct googleapis
 * calls using existing OAuth tokens.
 *
 * Mounted at POST /mcp/google
 */
import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { google, drive_v3, sheets_v4, gmail_v1, calendar_v3 } from 'googleapis';
import { logger } from '../logger.js';

// ── Credential paths ──

const HOME = process.env.HOME || process.env.USERPROFILE || '';

const DRIVE_OAUTH_KEYS = path.join(HOME, '.google-drive-mcp', 'gcp-oauth.keys.json');
const DRIVE_TOKENS = path.join(HOME, '.google-drive-mcp', 'credentials.json');

const SHEETS_OAUTH_KEYS = path.join(HOME, '.google-sheets-mcp', 'gcp-oauth.keys.json');
const SHEETS_TOKENS = path.join(HOME, '.google-sheets-mcp', 'credentials.json');

const GMAIL_OAUTH_KEYS = path.join(HOME, '.gmail-mcp', 'gcp-oauth.keys.json');
const GMAIL_TOKENS = path.join(HOME, '.gmail-mcp', 'credentials.json');

const CALENDAR_OAUTH_KEYS = path.join(HOME, '.google-calendar-mcp', 'credentials.json');
const CALENDAR_TOKENS = path.join(HOME, '.config', 'google-calendar-mcp', 'tokens.json');

// ── Cached clients ──

let driveClient: drive_v3.Drive | null = null;
let sheetsClient: sheets_v4.Sheets | null = null;
let gmailClient: gmail_v1.Gmail | null = null;
let calendarClient: calendar_v3.Calendar | null = null;

function loadOAuthClient(keysPath: string, tokensPath: string): InstanceType<typeof google.auth.OAuth2> | null {
  try {
    if (!fs.existsSync(keysPath) || !fs.existsSync(tokensPath)) return null;
    const config = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    const creds = config.installed ?? config.web;
    if (!creds?.client_id || !creds?.client_secret) return null;

    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    if (!tokens?.refresh_token) return null;

    const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret);
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
    });

    // Persist refreshed tokens to disk
    oauth2.on('tokens', (newTokens) => {
      try {
        const existing = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        if (newTokens.access_token) existing.access_token = newTokens.access_token;
        if (newTokens.refresh_token) existing.refresh_token = newTokens.refresh_token;
        fs.writeFileSync(tokensPath, JSON.stringify(existing, null, 2));
      } catch { /* ignore write errors */ }
    });

    return oauth2;
  } catch {
    return null;
  }
}

function getDrive(): drive_v3.Drive | null {
  if (driveClient) return driveClient;
  const auth = loadOAuthClient(DRIVE_OAUTH_KEYS, DRIVE_TOKENS);
  if (!auth) return null;
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function getSheets(): sheets_v4.Sheets | null {
  if (sheetsClient) return sheetsClient;
  const auth = loadOAuthClient(SHEETS_OAUTH_KEYS, SHEETS_TOKENS);
  if (!auth) return null;
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function loadCalendarOAuthClient(): InstanceType<typeof google.auth.OAuth2> | null {
  try {
    if (!fs.existsSync(CALENDAR_OAUTH_KEYS) || !fs.existsSync(CALENDAR_TOKENS)) return null;
    const config = JSON.parse(fs.readFileSync(CALENDAR_OAUTH_KEYS, 'utf-8'));
    const creds = config.installed ?? config.web;
    if (!creds?.client_id || !creds?.client_secret) return null;

    const tokensFile = JSON.parse(fs.readFileSync(CALENDAR_TOKENS, 'utf-8'));
    // Calendar tokens are wrapped: { normal: { access_token, refresh_token } }
    const tokens = tokensFile.normal ?? tokensFile;
    if (!tokens?.refresh_token) return null;

    const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret);
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
    });

    oauth2.on('tokens', (newTokens) => {
      try {
        const existing = JSON.parse(fs.readFileSync(CALENDAR_TOKENS, 'utf-8'));
        const target = existing.normal ?? existing;
        if (newTokens.access_token) target.access_token = newTokens.access_token;
        if (newTokens.refresh_token) target.refresh_token = newTokens.refresh_token;
        fs.writeFileSync(CALENDAR_TOKENS, JSON.stringify(existing, null, 2));
      } catch { /* ignore */ }
    });

    return oauth2;
  } catch {
    return null;
  }
}

function getGmail(): gmail_v1.Gmail | null {
  if (gmailClient) return gmailClient;
  const auth = loadOAuthClient(GMAIL_OAUTH_KEYS, GMAIL_TOKENS);
  if (!auth) return null;
  gmailClient = google.gmail({ version: 'v1', auth });
  return gmailClient;
}

function getCalendar(): calendar_v3.Calendar | null {
  if (calendarClient) return calendarClient;
  const auth = loadCalendarOAuthClient();
  if (!auth) return null;
  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

// Reset cached clients (called on disconnect/reconnect)
export function resetGoogleClients(): void {
  driveClient = null;
  sheetsClient = null;
  gmailClient = null;
  calendarClient = null;
}

// ── Tool definitions ──

const TOOLS = [
  {
    name: 'search_files',
    description: 'Search for files in Google Drive by name or content',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query (file name or content)' } }, required: ['query'] },
  },
  {
    name: 'list_files',
    description: 'List files in a Google Drive folder',
    inputSchema: { type: 'object', properties: { folderId: { type: 'string', description: 'Folder ID (default: root)' }, pageSize: { type: 'number', description: 'Max results (default: 20)' } } },
  },
  {
    name: 'get_file_content',
    description: 'Get the content of a file from Google Drive. Exports Google Docs as plain text.',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string', description: 'File ID' } }, required: ['fileId'] },
  },
  {
    name: 'create_file',
    description: 'Create a new file in Google Drive',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' }, mimeType: { type: 'string', description: 'MIME type (default: text/plain)' }, folderId: { type: 'string', description: 'Parent folder ID' } }, required: ['name', 'content'] },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder in Google Drive',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, parentId: { type: 'string', description: 'Parent folder ID' } }, required: ['name'] },
  },
  {
    name: 'list_spreadsheets',
    description: 'List Google Sheets spreadsheets',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional search filter' } } },
  },
  {
    name: 'read_sheet',
    description: 'Read data from a Google Sheets spreadsheet',
    inputSchema: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string', description: 'A1 notation range (e.g. Sheet1!A1:D10)' } }, required: ['spreadsheetId', 'range'] },
  },
  {
    name: 'write_sheet',
    description: 'Write data to a Google Sheets spreadsheet',
    inputSchema: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string', description: 'A1 notation range' }, values: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '2D array of cell values' } }, required: ['spreadsheetId', 'range', 'values'] },
  },
  // ── Gmail tools ──
  {
    name: 'list_emails',
    description: 'List recent emails from Gmail inbox',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query (e.g. "from:alice", "is:unread", "subject:invoice")' }, maxResults: { type: 'number', description: 'Max results (default: 10)' } } },
  },
  {
    name: 'read_email',
    description: 'Read the full content of a specific email by ID',
    inputSchema: { type: 'object', properties: { messageId: { type: 'string', description: 'Gmail message ID' } }, required: ['messageId'] },
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail',
    inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email' }, subject: { type: 'string' }, body: { type: 'string', description: 'Email body (plain text)' }, cc: { type: 'string', description: 'CC recipient (optional)' } }, required: ['to', 'subject', 'body'] },
  },
  {
    name: 'search_emails',
    description: 'Search emails with Gmail query syntax and return summaries',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query' }, maxResults: { type: 'number', description: 'Max results (default: 10)' } }, required: ['query'] },
  },
  // ── Calendar tools ──
  {
    name: 'list_events',
    description: 'List upcoming calendar events',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Number of days to look ahead (default: 1)' }, maxResults: { type: 'number', description: 'Max events (default: 20)' } } },
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string', description: 'Start time (ISO 8601)' }, end: { type: 'string', description: 'End time (ISO 8601)' }, description: { type: 'string' }, location: { type: 'string' } }, required: ['title', 'start', 'end'] },
  },
  {
    name: 'delete_event',
    description: 'Delete a calendar event by ID',
    inputSchema: { type: 'object', properties: { eventId: { type: 'string' } }, required: ['eventId'] },
  },
  {
    name: 'update_event',
    description: 'Update an existing calendar event',
    inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, title: { type: 'string' }, start: { type: 'string', description: 'ISO 8601' }, end: { type: 'string', description: 'ISO 8601' }, description: { type: 'string' }, location: { type: 'string' } }, required: ['eventId'] },
  },
];

// ── Tool implementations ──

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(msg: string): ToolResult {
  return textResult(`Error: ${msg}`);
}

const FILE_FIELDS = 'files(id,name,mimeType,modifiedTime,size,webViewLink)';

async function searchFiles(args: { query: string }): Promise<ToolResult> {
  const drive = getDrive();
  if (!drive) return errorResult('Google Drive not authenticated. Connect via dashboard Settings → Integrations.');
  const res = await drive.files.list({
    q: `name contains '${args.query.replace(/'/g, "\\'")}'`,
    fields: FILE_FIELDS,
    pageSize: 20,
    orderBy: 'modifiedTime desc',
  });
  const files = res.data.files ?? [];
  if (files.length === 0) return textResult(`No files found matching "${args.query}"`);
  return textResult(JSON.stringify(files, null, 2));
}

async function listFiles(args: { folderId?: string; pageSize?: number }): Promise<ToolResult> {
  const drive = getDrive();
  if (!drive) return errorResult('Google Drive not authenticated.');
  const folderId = args.folderId || 'root';
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: FILE_FIELDS,
    pageSize: args.pageSize || 20,
    orderBy: 'modifiedTime desc',
  });
  return textResult(JSON.stringify(res.data.files ?? [], null, 2));
}

async function getFileContent(args: { fileId: string }): Promise<ToolResult> {
  const drive = getDrive();
  if (!drive) return errorResult('Google Drive not authenticated.');

  // Get file metadata first to determine type
  const meta = await drive.files.get({ fileId: args.fileId, fields: 'id,name,mimeType,size' });
  const mimeType = meta.data.mimeType || '';

  // Google Docs → export as plain text
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export({ fileId: args.fileId, mimeType: 'text/plain' }, { responseType: 'text' });
    return textResult(String(res.data));
  }

  // Google Sheets → export as CSV
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await drive.files.export({ fileId: args.fileId, mimeType: 'text/csv' }, { responseType: 'text' });
    return textResult(String(res.data));
  }

  // Google Slides → export as plain text
  if (mimeType === 'application/vnd.google-apps.presentation') {
    const res = await drive.files.export({ fileId: args.fileId, mimeType: 'text/plain' }, { responseType: 'text' });
    return textResult(String(res.data));
  }

  // Text-based files → download content
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
    const res = await drive.files.get({ fileId: args.fileId, alt: 'media' }, { responseType: 'text' });
    return textResult(String(res.data));
  }

  // Binary files → return metadata only
  return textResult(`Binary file: ${meta.data.name} (${mimeType}, ${meta.data.size} bytes). Use webViewLink to access.`);
}

async function createFile(args: { name: string; content: string; mimeType?: string; folderId?: string }): Promise<ToolResult> {
  const drive = getDrive();
  if (!drive) return errorResult('Google Drive not authenticated.');
  const res = await drive.files.create({
    requestBody: {
      name: args.name,
      parents: args.folderId ? [args.folderId] : undefined,
    },
    media: {
      mimeType: args.mimeType || 'text/plain',
      body: args.content,
    },
    fields: 'id,name,webViewLink',
  });
  return textResult(JSON.stringify(res.data, null, 2));
}

async function createFolder(args: { name: string; parentId?: string }): Promise<ToolResult> {
  const drive = getDrive();
  if (!drive) return errorResult('Google Drive not authenticated.');
  const res = await drive.files.create({
    requestBody: {
      name: args.name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: args.parentId ? [args.parentId] : undefined,
    },
    fields: 'id,name,webViewLink',
  });
  return textResult(JSON.stringify(res.data, null, 2));
}

async function listSpreadsheets(args: { query?: string }): Promise<ToolResult> {
  const drive = getDrive();
  if (!drive) return errorResult('Google Drive not authenticated.');
  let q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed = false";
  if (args.query) q += ` and name contains '${args.query.replace(/'/g, "\\'")}'`;
  const res = await drive.files.list({
    q,
    fields: FILE_FIELDS,
    pageSize: 20,
    orderBy: 'modifiedTime desc',
  });
  return textResult(JSON.stringify(res.data.files ?? [], null, 2));
}

async function readSheet(args: { spreadsheetId: string; range: string }): Promise<ToolResult> {
  const sheets = getSheets();
  if (!sheets) return errorResult('Google Sheets not authenticated. Connect via dashboard Settings → Integrations.');
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: args.spreadsheetId,
    range: args.range,
  });
  return textResult(JSON.stringify(res.data.values ?? [], null, 2));
}

async function writeSheet(args: { spreadsheetId: string; range: string; values: string[][] }): Promise<ToolResult> {
  const sheets = getSheets();
  if (!sheets) return errorResult('Google Sheets not authenticated.');
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: args.spreadsheetId,
    range: args.range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: args.values },
  });
  return textResult(`Updated ${res.data.updatedCells} cells in range ${res.data.updatedRange}`);
}

// ── Gmail implementations ──

async function listEmails(args: { query?: string; maxResults?: number }): Promise<ToolResult> {
  const gmail = getGmail();
  if (!gmail) return errorResult('Gmail not authenticated. Connect via dashboard Settings → Integrations.');
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: args.query || 'in:inbox',
    maxResults: args.maxResults || 10,
  });
  const messages = res.data.messages ?? [];
  if (messages.length === 0) return textResult('No messages found.');

  // Fetch headers for each message
  const summaries = await Promise.all(
    messages.map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
      const headers = msg.data.payload?.headers ?? [];
      const get = (name: string) => headers.find((h) => h.name === name)?.value ?? '';
      return { id: m.id, from: get('From'), subject: get('Subject'), date: get('Date'), snippet: msg.data.snippet };
    }),
  );
  return textResult(JSON.stringify(summaries, null, 2));
}

async function readEmail(args: { messageId: string }): Promise<ToolResult> {
  const gmail = getGmail();
  if (!gmail) return errorResult('Gmail not authenticated.');
  const msg = await gmail.users.messages.get({ userId: 'me', id: args.messageId, format: 'full' });

  const headers = msg.data.payload?.headers ?? [];
  const get = (name: string) => headers.find((h) => h.name === name)?.value ?? '';

  // Extract plain text body
  let body = '';
  const extractText = (part: gmail_v1.Schema$MessagePart): void => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) part.parts.forEach(extractText);
  };
  if (msg.data.payload) extractText(msg.data.payload);

  return textResult(JSON.stringify({
    id: msg.data.id,
    from: get('From'),
    to: get('To'),
    subject: get('Subject'),
    date: get('Date'),
    body: body || msg.data.snippet || '',
  }, null, 2));
}

async function sendEmail(args: { to: string; subject: string; body: string; cc?: string }): Promise<ToolResult> {
  const gmail = getGmail();
  if (!gmail) return errorResult('Gmail not authenticated.');

  const lines = [
    `To: ${args.to}`,
    args.cc ? `Cc: ${args.cc}` : '',
    `Subject: ${args.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    args.body,
  ].filter(Boolean);

  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return textResult(`Email sent. Message ID: ${res.data.id}`);
}

async function searchEmails(args: { query: string; maxResults?: number }): Promise<ToolResult> {
  return listEmails({ query: args.query, maxResults: args.maxResults });
}

// ── Calendar implementations ──

async function listEvents(args: { days?: number; maxResults?: number }): Promise<ToolResult> {
  const cal = getCalendar();
  if (!cal) return errorResult('Google Calendar not authenticated. Connect via dashboard Settings → Integrations.');
  const timeMin = new Date();
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + (args.days || 1));

  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: args.maxResults || 20,
  });

  const events = (res.data.items ?? []).map((e) => ({
    id: e.id,
    title: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location,
    description: e.description,
  }));
  if (events.length === 0) return textResult('No events found.');
  return textResult(JSON.stringify(events, null, 2));
}

async function createEvent(args: { title: string; start: string; end: string; description?: string; location?: string }): Promise<ToolResult> {
  const cal = getCalendar();
  if (!cal) return errorResult('Google Calendar not authenticated.');
  const res = await cal.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: args.title,
      start: { dateTime: args.start },
      end: { dateTime: args.end },
      description: args.description,
      location: args.location,
    },
  });
  return textResult(JSON.stringify({ id: res.data.id, title: res.data.summary, start: res.data.start, end: res.data.end, htmlLink: res.data.htmlLink }, null, 2));
}

async function deleteEvent(args: { eventId: string }): Promise<ToolResult> {
  const cal = getCalendar();
  if (!cal) return errorResult('Google Calendar not authenticated.');
  await cal.events.delete({ calendarId: 'primary', eventId: args.eventId });
  return textResult(`Event ${args.eventId} deleted.`);
}

async function updateEvent(args: { eventId: string; title?: string; start?: string; end?: string; description?: string; location?: string }): Promise<ToolResult> {
  const cal = getCalendar();
  if (!cal) return errorResult('Google Calendar not authenticated.');

  const patch: calendar_v3.Schema$Event = {};
  if (args.title !== undefined) patch.summary = args.title;
  if (args.start !== undefined) patch.start = { dateTime: args.start };
  if (args.end !== undefined) patch.end = { dateTime: args.end };
  if (args.description !== undefined) patch.description = args.description;
  if (args.location !== undefined) patch.location = args.location;

  const res = await cal.events.patch({ calendarId: 'primary', eventId: args.eventId, requestBody: patch });
  return textResult(JSON.stringify({ id: res.data.id, title: res.data.summary, start: res.data.start, end: res.data.end }, null, 2));
}

// ── Tool dispatch ──

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  // Drive
  search_files: (a) => searchFiles(a as { query: string }),
  list_files: (a) => listFiles(a as { folderId?: string; pageSize?: number }),
  get_file_content: (a) => getFileContent(a as { fileId: string }),
  create_file: (a) => createFile(a as { name: string; content: string; mimeType?: string; folderId?: string }),
  create_folder: (a) => createFolder(a as { name: string; parentId?: string }),
  // Sheets
  list_spreadsheets: (a) => listSpreadsheets(a as { query?: string }),
  read_sheet: (a) => readSheet(a as { spreadsheetId: string; range: string }),
  write_sheet: (a) => writeSheet(a as { spreadsheetId: string; range: string; values: string[][] }),
  // Gmail
  list_emails: (a) => listEmails(a as { query?: string; maxResults?: number }),
  read_email: (a) => readEmail(a as { messageId: string }),
  send_email: (a) => sendEmail(a as { to: string; subject: string; body: string; cc?: string }),
  search_emails: (a) => searchEmails(a as { query: string; maxResults?: number }),
  // Calendar
  list_events: (a) => listEvents(a as { days?: number; maxResults?: number }),
  create_event: (a) => createEvent(a as { title: string; start: string; end: string; description?: string; location?: string }),
  delete_event: (a) => deleteEvent(a as { eventId: string }),
  update_event: (a) => updateEvent(a as { eventId: string; title?: string; start?: string; end?: string; description?: string; location?: string }),
};

// ── JSON-RPC types ──

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── Main HTTP handler ──

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Only accept POST
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Method not allowed. Use POST.' } }));
    return;
  }

  // Read body
  const body = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  let rpcReq: JsonRpcRequest;
  try {
    rpcReq = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
    return;
  }

  const respond = (result?: unknown, error?: { code: number; message: string }) => {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id: rpcReq.id ?? null };
    if (error) response.error = error;
    else response.result = result;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  };

  // Notifications (no id) — acknowledge without response
  if (rpcReq.id === undefined || rpcReq.id === null) {
    res.writeHead(202);
    res.end();
    return;
  }

  switch (rpcReq.method) {
    case 'initialize':
      respond({
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'nanoclaw-google', version: '1.0.0' },
      });
      break;

    case 'tools/list':
      respond({ tools: TOOLS });
      break;

    case 'tools/call': {
      const toolName = (rpcReq.params as { name?: string })?.name;
      const toolArgs = (rpcReq.params as { arguments?: Record<string, unknown> })?.arguments ?? {};

      if (!toolName || !TOOL_HANDLERS[toolName]) {
        respond(undefined, { code: -32602, message: `Unknown tool: ${toolName}` });
        break;
      }

      try {
        const result = await TOOL_HANDLERS[toolName](toolArgs);
        respond(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, tool: toolName }, 'MCP tool call failed');
        respond({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
      }
      break;
    }

    default:
      respond(undefined, { code: -32601, message: `Method not found: ${rpcReq.method}` });
  }
}

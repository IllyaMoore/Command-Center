import { test, expect } from '@playwright/test';

// --- Page load ---

test('dashboard loads with topbar and status', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.brand')).toContainText('Command Center');
  await expect(page.locator('#agentStatus')).toBeVisible();
  await expect(page.locator('.clock')).toBeVisible();
});

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe('ok');
});

// --- Chat ---

test('chat panel is visible on desktop', async ({ page }) => {
  await page.goto('/');

  const chatPane = page.locator('#chatPane');
  await expect(chatPane).toBeVisible();
  await expect(page.locator('#chatInput')).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeVisible();
});

test('typing and pressing Enter sends a user message', async ({ page }) => {
  await page.goto('/');

  const input = page.locator('#chatInput');
  const chatMsgs = page.locator('#chatMsgs');

  await input.fill('Hello from Playwright');
  await input.press('Enter');

  // User message bubble should appear
  const userMsg = chatMsgs.locator('.msg-u').last();
  await expect(userMsg).toContainText('Hello from Playwright');

  // Input should be cleared
  await expect(input).toHaveValue('');
});

test('clicking send button sends a user message', async ({ page }) => {
  await page.goto('/');

  const input = page.locator('#chatInput');
  await input.fill('Click send test');
  await page.locator('#sendBtn').click();

  const userMsg = page.locator('#chatMsgs .msg-u').last();
  await expect(userMsg).toContainText('Click send test');
  await expect(input).toHaveValue('');
});

test('empty input does not create a message', async ({ page }) => {
  await page.goto('/');

  // Wait for initial SSE to populate chat
  await page.waitForTimeout(500);

  const msgCountBefore = await page.locator('#chatMsgs .msg').count();

  await page.locator('#chatInput').press('Enter');
  await page.waitForTimeout(200);

  const msgCountAfter = await page.locator('#chatMsgs .msg').count();
  expect(msgCountAfter).toBe(msgCountBefore);
});

test('SSE loads initial chat history', async ({ page }) => {
  await page.goto('/');

  // Wait for SSE initial event to populate messages
  await expect(page.locator('#chatMsgs .msg').first()).toBeVisible({ timeout: 5000 });

  // Should contain at least the 2 seeded messages (earlier tests may add more)
  const msgs = page.locator('#chatMsgs .msg');
  const count = await msgs.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Seeded messages should be present
  await expect(page.locator('#chatMsgs')).toContainText('Hello from the test');
  await expect(page.locator('#chatMsgs')).toContainText('How can I help you today?');
});

test('POST /api/chat returns success', async ({ request }) => {
  const res = await request.post('/api/chat', {
    data: { text: 'API test message' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
});

test('POST /api/chat without text returns 400', async ({ request }) => {
  const res = await request.post('/api/chat', {
    data: {},
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('Missing text field');
});

// --- Mobile chat ---

test('mobile chat opens via FAB button', async ({ page }) => {
  // Set mobile viewport
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');

  // FAB should be visible on mobile
  const fab = page.locator('#mobileChatFab');
  await expect(fab).toBeVisible();

  // Click FAB to open chat overlay
  await fab.click();

  const panel = page.locator('#mobileChatPanel');
  await expect(panel).toHaveClass(/open/);

  // Type and send
  const input = page.locator('#mobileChatInput');
  await input.fill('Mobile message');
  await page.locator('#mobileSendBtn').click();

  const mobileMsg = page.locator('#mobileMsgs .msg-u').last();
  await expect(mobileMsg).toContainText('Mobile message');
});

// --- Calendar & Activity panes ---

test('calendar pane is visible with Daily/Weekly toggle', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#calPane')).toBeVisible();
  await expect(page.locator('#calPane .pane-title')).toContainText('Calendar');

  const buttons = page.locator('#calPane .pane-toggle button');
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toContainText('Daily');
  await expect(buttons.nth(1)).toContainText('Weekly');
});

test('activity pane is visible with filter pills', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#actPane')).toBeVisible();
  await expect(page.locator('#actPane .pane-title')).toContainText('Activity');
  await expect(page.locator('.pill').first()).toBeVisible();
});

// --- Settings ---

test('settings panel opens and closes', async ({ page }) => {
  // Use mobile viewport where settings button is visible
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');

  // Open settings
  await page.locator('.settings-btn').click();
  const overlay = page.locator('#settingsOverlay');
  await expect(overlay).toHaveClass(/open/);

  // Close settings
  await page.locator('.settings-close').click();
  await expect(overlay).not.toHaveClass(/open/);
});

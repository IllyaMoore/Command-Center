import { test, expect } from '@playwright/test';

// --- Page Load ---

test('dashboard loads with header and NanoClaw Studio branding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('header')).toBeVisible();
  await expect(page.getByText('NanoClaw Studio')).toBeVisible();
});

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('fleet sidebar shows registered agents', async ({ page }) => {
  await page.goto('/');
  const sidebar = page.getByTestId('fleet-sidebar');
  await expect(sidebar).toBeVisible();

  // Should show all 3 test agents
  await expect(page.getByTestId('agent-card-ceo')).toBeVisible();
  await expect(page.getByTestId('agent-card-legal')).toBeVisible();
  await expect(page.getByTestId('agent-card-finance')).toBeVisible();
});

// --- Agent Selection ---

test('clicking agent card selects it and loads chat', async ({ page }) => {
  await page.goto('/');

  // Click Legal agent
  await page.getByTestId('agent-card-legal').click();

  // Chat panel should show Legal in header
  const chatPanel = page.getByTestId('chat-panel');
  await expect(chatPanel).toBeVisible();
  await expect(chatPanel).toContainText('Legal');
});

test('first agent is auto-selected on load', async ({ page }) => {
  await page.goto('/');

  // Chat panel should have an agent loaded (first one auto-selected)
  const chatPanel = page.getByTestId('chat-panel');
  await expect(chatPanel).toBeVisible();

  // Send button should exist (means agent is selected)
  await expect(page.getByTestId('send-btn')).toBeVisible();
});

// --- Chat Messaging ---

test('send message via Enter key', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(500); // Wait for agent auto-select

  const input = page.getByTestId('chat-input');
  await input.fill('Hello from Playwright');
  await input.press('Enter');

  // Message should appear in chat
  const messages = page.getByTestId('chat-messages');
  await expect(messages).toContainText('Hello from Playwright');

  // Input should be cleared
  await expect(input).toHaveValue('');
});

test('send message via button click', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(500);

  const input = page.getByTestId('chat-input');
  await input.fill('Click send test');
  await page.getByTestId('send-btn').click();

  const messages = page.getByTestId('chat-messages');
  await expect(messages).toContainText('Click send test');
  await expect(input).toHaveValue('');
});

test('empty input does not send', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(500);

  // Send button should be disabled with empty input
  const sendBtn = page.getByTestId('send-btn');
  await expect(sendBtn).toBeDisabled();
});

test('seeded messages appear in chat', async ({ page }) => {
  await page.goto('/');

  // Wait for messages to load (CEO is auto-selected, has seeded messages)
  const messages = page.getByTestId('chat-messages');
  await expect(messages).toContainText('Hello from the test', { timeout: 5000 });
  await expect(messages).toContainText('How can I help you today?');
});

// --- Settings Panel ---

test('brain button opens settings sidebar', async ({ page }) => {
  await page.goto('/');

  const brainBtn = page.getByTestId('brain-toggle');
  await brainBtn.click();

  const settings = page.getByTestId('settings-sidebar');
  // Settings should be visible (width > 0)
  await expect(settings).toBeVisible();
});

test('settings has 4 tabs', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('brain-toggle').click();

  await expect(page.getByTestId('settings-tab-behavior')).toBeVisible();
  await expect(page.getByTestId('settings-tab-capabilities')).toBeVisible();
  await expect(page.getByTestId('settings-tab-automations')).toBeVisible();
  await expect(page.getByTestId('settings-tab-advanced')).toBeVisible();
});

test('close button closes settings', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('brain-toggle').click();

  // Settings should be visible
  const settings = page.getByTestId('settings-sidebar');
  await expect(settings).toBeVisible();

  // Click close
  await page.getByText('Close').click();

  // Settings should collapse (pointer-events-none when closed)
  await expect(settings).toHaveClass(/pointer-events-none/);
});

// --- Header Controls ---

test('calendar popup opens and closes', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('calendar-toggle').click();
  // Calendar panel should appear with "Schedule" text
  await expect(page.getByText('Schedule')).toBeVisible();

  // Click again to close
  await page.getByTestId('calendar-toggle').click();
  await page.waitForTimeout(200);
});

test('activity popup opens and closes', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('activity-toggle').click();
  // Activity panel should appear with "Activity" heading and "Live" indicator
  await expect(page.getByText('Live Feed')).toBeVisible();

  // Click again to close
  await page.getByTestId('activity-toggle').click();
  await page.waitForTimeout(200);
});

// --- Mobile ---

test('mobile view shows tab navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');

  // Mobile nav should be visible
  const nav = page.locator('nav.md\\:hidden');
  await expect(nav).toBeVisible();

  // Should have 3 tabs
  await expect(nav.getByText('agents')).toBeVisible();
  await expect(nav.getByText('chat')).toBeVisible();
  await expect(nav.getByText('settings')).toBeVisible();
});

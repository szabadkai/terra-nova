// Reproducible production renderer benchmark. Builds are done by the npm script; this starts the
// production preview, launches an isolated Chrome profile, and compares the old and new render
// policy on the same deterministic 20-minute town and camera motion.
//
//   npm run benchmark
//   CHROME=/path/to/chrome HEADLESS=0 npm run benchmark
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const port = 4187;
const origin = `http://127.0.0.1:${port}`;
const chrome = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
if (!chrome) throw new Error('Chrome/Chromium not found; set CHROME=/path/to/browser');

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) return; } catch { /* preview is starting */ }
    await delay(100);
  }
  throw new Error('production preview did not start');
}

async function sample(browser, baseline) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  const query = new URLSearchParams({ play: '1', perf: '1', benchmark: '1', benchmarkMinutes: '20', seed: '8176', size: '192', players: '4' });
  if (baseline) query.set('perfBaseline', '1');
  await page.goto(`${origin}/?${query}`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => document.body.dataset.benchmark && document.querySelector('#perf-stats')?.dataset.report, { timeout: 120_000 });
  await page.bringToFront();
  await page.click('#c');
  await page.keyboard.down('q');
  // Repeated input keeps Quiet in its interactive 60 fps state while the held arrow moves the view.
  for (let i = 0; i < 14; i++) { await delay(500); await page.keyboard.press('Shift'); }
  await page.keyboard.up('q');
  const active = await page.$eval('#perf-stats', (el) => JSON.parse(el.dataset.report));
  await delay(12_000);
  const idle = await page.$eval('#perf-stats', (el) => JSON.parse(el.dataset.report));
  const workload = await page.evaluate(() => JSON.parse(document.body.dataset.benchmark));
  await page.close();
  return { workload, active, idle };
}

try {
  await ready();
  const browser = await puppeteer.launch({ executablePath: chrome, headless: process.env.HEADLESS !== '0', args: ['--no-first-run', '--disable-background-networking'] });
  try {
    const baseline = await sample(browser, true);
    const optimized = await sample(browser, false);
    console.log(JSON.stringify({ baseline, optimized }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}

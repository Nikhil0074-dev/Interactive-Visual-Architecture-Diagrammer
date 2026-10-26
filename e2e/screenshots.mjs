// End-to-end test + screenshot generator. Requires `npm run build` first.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3100, URL = `http://localhost:${PORT}`, OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const nextCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const server = spawn(nextCommand, ['next', 'start', '-p', String(PORT)], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
  env: { ...process.env, ANTHROPIC_API_KEY: '' },
});
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

async function launch() {
  try { return await chromium.launch(); } catch {
    const { default: sp } = await import('@sparticuz/chromium');
    return chromium.launch({ executablePath: await sp.executablePath(), args: sp.args });
  }
}
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/status of 422/.test(m.text()) && errors.push(m.text()));
const count = () => page.getByTestId('arch-node').count();
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
let step = 0;
const ok = (m) => console.log(`✓ ${++step}. ${m}`);

try {
  await page.goto(URL);
  await page.getByText('Empty canvas').waitFor();
  assert.equal(await count(), 0);
  await shot('01-empty-editor'); ok('empty editor renders');

  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await page.getByText(/Generated 5 components/).waitFor();
  assert.equal(await count(), 5);
  assert.match(await page.getByLabel('Mermaid source').textContent(), /^flowchart LR/);
  await page.getByText('No issues found.').waitFor();
  await shot('02-generated-ecommerce'); ok('e-commerce prompt -> 5 nodes, Mermaid, no validation issues');

  await page.getByRole('button', { name: 'Example 2' }).click();
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await page.getByText(/Generated 8 components/).waitFor();
  assert.equal(await count(), 8);
  await shot('03-generated-food-delivery'); ok('food-delivery prompt -> 8 nodes');

  await page.getByRole('button', { name: 'Preview change' }).click();
  await page.getByTestId('preview').waitFor();
  await shot('04-ai-change-preview');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByText('Changes applied.').waitFor();
  assert.equal(await count(), 9);
  ok('AI modification previewed and applied (+1 node)');

  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=arch-node]').length === 8);
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=arch-node]').length === 9);
  ok('undo / redo');

  await page.getByTestId('arch-node').filter({ hasText: 'Order Service' }).click();
  await page.getByLabel('Node name').fill('Orders API');
  await page.getByTestId('arch-node').filter({ hasText: 'Orders API' }).waitFor();
  await shot('05-properties-panel'); ok('select node and rename via properties panel');

  const n0 = await count();
  await page.getByRole('button', { name: 'Add node' }).click();
  assert.equal(await count(), n0 + 1);
  await page.getByRole('button', { name: 'Delete node' }).click();
  assert.equal(await count(), n0);
  ok('add and delete node');

  const box = await page.getByTestId('arch-node').first().boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 90, { steps: 5 }); await page.mouse.up();
  const box2 = await page.getByTestId('arch-node').first().boundingBox();
  assert.notEqual(Math.round(box.y), Math.round(box2.y));
  ok('drag node');

  await page.getByLabel('Modification instruction').fill('make it web scale');
  await page.getByRole('button', { name: 'Preview change' }).click();
  await page.getByText(/Could not interpret/).waitFor();
  await shot('06-error-handling'); ok('unintelligible instruction shows a friendly error');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON' }).click()]);
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert.equal(json.nodes.length, 9);
  assert.ok(json.edges.every((e) => json.nodes.some((n) => n.id === e.source) && json.nodes.some((n) => n.id === e.target)));
  ok('JSON export is valid and consistent');

  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText(/Saved "/).waitFor();
  ok('save to browser storage');

  assert.deepEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
  ok('no console or page errors');
  console.log(`\nAll ${step} end-to-end checks passed.`);
} catch (e) {
  await shot('FAILURE').catch(() => {});
  console.error('E2E FAILED:', e.message); process.exitCode = 1;
} finally { await browser.close(); stop(); }

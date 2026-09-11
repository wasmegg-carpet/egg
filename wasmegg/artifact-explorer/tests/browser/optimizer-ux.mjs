// Run against pnpm dev. Set PLAYWRIGHT_MODULE to a Playwright installation if it isn't local.
// No account/network save needed; requests use the real worker with controllable reply delivery.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.OPTIMIZER_URL || 'http://localhost:5190/artifact-explorer/';
const shots = process.env.OPTIMIZER_SHOTS || '/tmp/optimizer-ux-verified';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  performance.setResourceTimingBufferSize(5000);
  // A previous manual-mode preference no longer disables recomputation.
  localStorage[`${location.pathname}_auto_compute`] = 'false';
  const NativeWorker = window.Worker;
  window.optimizerProbe = { requests: [], held: [], hold: false, failNext: false };
  window.Worker = class {
    constructor(url, options) {
      this.worker = new NativeWorker(url, options);
      this.worker.onmessage = e => {
        const deliver = () => this.onmessage?.(e);
        if (window.optimizerProbe.hold) window.optimizerProbe.held.push(deliver);
        else deliver();
      };
      this.worker.onerror = e => this.onerror?.(e);
    }
    postMessage(request) {
      window.optimizerProbe.requests.push(request);
      if (window.optimizerProbe.failNext) {
        window.optimizerProbe.failNext = false;
        setTimeout(() => this.onmessage?.({ data: { id: request.id, ok: false, error: 'Test worker failure' } }), 20);
      } else this.worker.postMessage(request);
    }
    terminate() {
      this.worker.terminate();
    }
  };
});
const status = page.locator('.optimizer-toolbar [role=status]');
const settled = async () => {
  await page.waitForFunction(
    () => document.querySelector('.optimizer-toolbar [role=status]')?.textContent.includes('Current result'),
    { timeout: 60000 }
  );
};
const store = async code =>
  page.evaluate(async code => {
    const moduleURL = name =>
      performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith(`/src/store/${name}.ts`))
        .name;
    const s = await import(moduleURL('index'));
    const p = await import(moduleURL('plan'));
    return new Function('s', 'p', code)(s, p);
  }, code);
const hold = async () =>
  page.evaluate(() => {
    window.optimizerProbe.hold = true;
  });
const flush = async () =>
  page.evaluate(() => {
    window.optimizerProbe.hold = false;
    for (const deliver of window.optimizerProbe.held.splice(0)) deliver();
  });
const reply = async () => page.waitForFunction(() => window.optimizerProbe.held.length > 0);
const requestCount = async () => page.evaluate(() => window.optimizerProbe.requests.length);
const exportButton = page.getByRole('button', { name: /^Export \d+ solved visit/ });
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await status.waitFor();
  assert.match(await status.innerText(), /Not computed/);
  assert.equal(await requestCount(), 0);
  await page
    .locator('input[type=file]')
    .setInputFiles(new URL('../fixtures/ascension-plan.json', import.meta.url).pathname);
  assert.match(await page.locator('#planVisitSelect option').first().innerText(), /Standalone/);
  await page.locator('#planVisitSelect').selectOption('shift_a1b2c3d');
  assert.match(await status.innerText(), /Not computed/);
  const picker = page.getByPlaceholder('Add artifact (type to filter)');
  await picker.fill('Jeweled gusset');
  await picker.press('Enter');
  await settled();
  assert.equal(await store('return p.solvedVisitCount.value'), 1);
  assert.equal(await exportButton.isEnabled(), true);
  // Equivalent normalization must not turn inherited time into an override or queue a solve.
  let before = await requestCount();
  await page.locator('#waitTimeInput').focus();
  await page.locator('#waitTimeInput').blur();
  assert.equal(await store('return p.activeVisitSettings.value.waitTimeOverride'), null);
  assert.equal(await requestCount(), before);

  // Hold an actual worker reply to inspect pending state and export gating.
  await hold();
  await page.locator('#waitTimeInput').fill('2d');
  await reply();
  assert.match(await status.innerText(), /Computing/);
  assert.equal(await exportButton.isDisabled(), true);
  assert.equal(await page.locator('#optimizer-result [inert]').count(), 1);
  await page.locator('#optimizer-result').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${shots}/computing.png` });
  assert.match(await page.getByTestId('result-provenance').innerText(), /1d/);
  assert.equal(await store('return p.solvedVisitCount.value'), 0);
  // An invalid draft during a flight cannot be recorded when that flight completes.
  await page.locator('#waitTimeInput').fill('bad');
  await flush();
  assert.match(await status.innerText(), /outdated.*invalid/i);
  assert.equal(await store('return p.solvedVisitCount.value'), 0);
  await page.locator('#waitTimeInput').fill('2');
  await page.locator('#waitTimeInput').blur();
  await settled();
  assert.equal(await page.locator('#waitTimeInput').inputValue(), '2d');
  assert.match(await page.getByTestId('result-provenance').innerText(), /2d/);
  await page.getByRole('button', { name: 'Reset to plan time', exact: true }).click();
  await settled();
  assert.equal(await store('return p.activeVisitSettings.value.waitTimeOverride'), null);

  // Gem cap is local to each visit and invalid drafts never retain a previous solver cap.
  await page.locator('#gemCostMode').selectOption('custom');
  assert.equal(await store('return s.gemCostInvalid.value'), false);
  const gem = page.getByRole('textbox', { name: 'Maximum price per ship in gems', exact: true });
  await gem.fill('bad');
  await gem.blur();
  assert.equal(await gem.getAttribute('aria-invalid'), 'true');
  assert.equal(await exportButton.isDisabled(), true);
  assert.equal(await store('return Number.isNaN(s.effectiveMaxGemCost.value)'), true);
  await gem.fill('1000000');
  await gem.blur();
  await settled();
  assert.equal(await gem.inputValue(), '1M');
  before = await requestCount();
  await gem.fill('1000000');
  await gem.blur();
  await page.waitForTimeout(350);
  assert.equal(await requestCount(), before);
  assert.equal(await store('return p.solvedVisitCount.value'), 1);

  // Switching visits while a request is in flight cannot file its answer under the new visit.
  await hold();
  await page.locator('#waitTimeInput').fill('3d');
  await reply();
  await page.locator('#planVisitSelect').selectOption('shift_e5e5e5e');
  assert.equal(await page.locator('#gemCostMode').inputValue(), 'plan');
  assert.equal(await page.locator('#waitTimeInput').inputValue(), '');
  await flush();
  assert.equal(await store('return p.solvedVisitCount.value'), 0);
  await page.locator('#waitTimeInput').fill('4d');
  await settled();
  await page.locator('#planVisitSelect').selectOption('shift_a1b2c3d');
  await settled();
  assert.equal(await page.locator('#gemCostMode').inputValue(), 'custom');
  assert.equal(await gem.inputValue(), '1M');
  assert.equal(await store('return p.solvedVisitCount.value'), 2);

  // Shared effort retracts other visits too; a download contains only newly solved visits.
  await hold();
  await page.getByRole('slider', { name: 'Effort', exact: true }).press('ArrowRight');
  await reply();
  assert.equal(await store('return p.solvedVisitCount.value'), 0);
  assert.equal(await exportButton.isDisabled(), true);
  await flush();
  await settled();
  const downloaded = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloaded;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.visits.length, 1);
  assert.equal(exported.visits[0].visitId, 'shift_a1b2c3d');
  assert.equal(exported.visits[0].effort, 'high');
  // Both budget fields have identical draft rules, including zero and invalid hidden drafts.
  await page.locator('#craftCostMode').selectOption('custom');
  const craft = page.getByRole('textbox', { name: 'Total crafting budget in golden eggs', exact: true });
  await craft.fill('-1');
  await craft.blur();
  assert.equal(await craft.getAttribute('aria-invalid'), 'true');
  assert.match(await status.innerText(), /invalid/);
  await craft.fill('0');
  await craft.blur();
  await settled();
  assert.equal(await store('return s.effectiveCraftingBudget.value'), 0);
  await craft.fill('oops');
  await page.locator('#craftCostMode').selectOption('unlimited');
  await settled();

  // No target still has visit navigation; returning to an explicitly emptied visit stays empty.
  await page.getByRole('button', { name: 'Remove Jeweled gusset (T4)', exact: true }).click();
  assert.match(await status.innerText(), /Not computed/);
  assert.equal(await page.locator('#planVisitSelect').isVisible(), true);
  await page.locator('#planVisitSelect').selectOption('shift_e5e5e5e');
  await settled();
  await page.locator('#planVisitSelect').selectOption('shift_a1b2c3d');
  assert.equal(await store('return p.activeVisitSettings.value.targetIds.length'), 0);
  await page.locator('#planVisitSelect').selectOption('');
  await picker.fill('Jeweled gusset');
  await picker.press('Enter');
  await settled();
  await page.getByRole('spinbutton', { name: 'Fuel tank level', exact: true }).fill('2');
  await settled();
  assert.equal(await store('return s.effectiveTankLevel.value'), 2);
  assert.equal(
    await page.evaluate(() => window.optimizerProbe.requests.at(-1).args.fuelCapacity),
    await store('return s.effectiveFuelTankCapacity.value')
  );
  assert.equal(await page.getByLabel('Recompute automatically').count(), 0);
  // Save-backed values via a synthetic backup, without an account or a remote request.
  await store(
    `s.setPlayerData({game:{goldenEggsEarned:20000000,goldenEggsSpent:1000000,epicResearch:[]},artifactsDb:{inventoryItems:[],virtueAfxDb:{inventoryItems:[],artifactStatus:[]}},artifacts:{tankLevel:3,craftingXp:0},virtue:{afx:{tankFuels:Array.from({length:25},()=>10000000000)}}});`
  );
  await settled();
  assert.equal(await store('return s.effectiveTankLevel.value'), 3);
  await page.locator('#fuelBudgetMode').selectOption('banked');
  await settled();
  assert.equal(await page.getByRole('checkbox', { name: 'Override Fuel tank level', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.optimizerProbe.requests.at(-1).args.fuelByEggCapacity.size), 4);
  await page.locator('#fuelBudgetMode').selectOption('full-tank');
  await page.getByRole('checkbox', { name: 'Override Fuel tank level', exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Fuel tank level', exact: true }).fill('1');
  await settled();
  assert.equal(await store('return s.effectiveTankLevel.value'), 1);
  await page.getByRole('button', { name: 'Reset Fuel tank level to save', exact: true }).click();
  await settled();
  assert.equal(await store('return s.effectiveTankLevel.value'), 3);

  // The save/override ship table also remains usable on small screens.
  await page.getByRole('button', { name: 'Edit ships…', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Override Henerprise settings', exact: true }).check();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const savedStar = page.getByRole('button', { name: 'Henerprise: set 2 stars', exact: true });
    await savedStar.focus();
    await savedStar.press('Space');
    assert.equal(await savedStar.getAttribute('aria-pressed'), 'true');
    const panel = page.getByRole('dialog').locator('[class*="max-h-"]');
    assert.equal(await panel.evaluate(e => e.scrollWidth <= e.clientWidth), true);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${shots}/save-ships-${width}.png` });
  }
  await page.getByRole('checkbox', { name: 'Override Henerprise settings', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close ship settings', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settled();

  // Failure and retry, then keyboard-operable ship stars and layout at both sizes.
  await page.evaluate(() => {
    window.optimizerProbe.failNext = true;
  });
  await page.locator('#waitTimeInput').fill('8d');
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.match(await status.innerText(), /failed: Test worker failure/);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await settled();
  await store('s.clearPlayerData()');
  await settled();
  await page.getByRole('button', { name: 'Edit ships…', exact: true }).click();
  const star = page.getByRole('button', { name: 'Galeggtica: set 1 stars', exact: true });
  await star.focus();
  await star.press('Enter');
  assert.equal(await star.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Close ship settings', exact: true }).click();
  await settled();
  await page.locator('#optimizer-settings').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${shots}/desktop.png` });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '↑ Back to settings', exact: true }).click();
    await page.screenshot({ path: `${shots}/mobile-${width}-settings.png` });
    await page.getByRole('button', { name: 'View results ↓', exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'optimizer-result');
    assert.equal(
      await page
        .locator('#optimizer-result')
        .evaluate(
          e =>
            e.getBoundingClientRect().top >= document.querySelector('.optimizer-toolbar').getBoundingClientRect().bottom
        ),
      true
    );
    await page.screenshot({ path: `${shots}/mobile-${width}-results.png` });
    await page.getByRole('button', { name: '↑ Back to settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit ships…', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth), true);
    await page.waitForTimeout(350); // Let the dialog's entrance transition finish before capture.
    await page.screenshot({ path: `${shots}/mobile-${width}-ships.png` });
    await page.getByRole('button', { name: 'Close ship settings', exact: true }).click();
  }
  // Reloading a plan with the same visit IDs cannot accept the prior plan's pending answer.
  await hold();
  await page.locator('#planVisitSelect').selectOption('shift_e5e5e5e');
  await reply();
  await page
    .locator('input[type=file]')
    .setInputFiles(new URL('../fixtures/ascension-plan.json', import.meta.url).pathname);
  await page.locator('#planVisitSelect').selectOption('shift_e5e5e5e');
  await page.locator('#waitTimeInput').fill('4d');
  await page.waitForFunction(() => window.optimizerProbe.held.length >= 2);
  await page.evaluate(() => window.optimizerProbe.held.shift()());
  assert.equal(await store('return p.solvedVisitCount.value'), 0);
  assert.equal(await exportButton.isDisabled(), true);
  await flush();
  await settled();
  assert.equal(await store('return p.solvedVisitCount.value'), 1);
  await picker.fill('Lunar totem');
  await picker.press('Enter');
  await settled();
  assert.match(await page.locator('#optimizer-result').innerText(), /Joint chance of getting all 2 artifacts/);
  await page.locator('#planVisitSelect').selectOption('shift_a1b2c3d');
  await settled();
  await page.locator('#planVisitSelect').selectOption('shift_e5e5e5e');
  await settled();
  assert.equal(await store('return p.solvedVisitCount.value'), 2);
  // Reload preserves inputs, but unverified saved projections never enter a fresh session's export.
  await page.reload({ waitUntil: 'networkidle' });
  await settled();
  assert.equal(await store('return p.activeVisitSettings.value.targetIds.length'), 2);
  assert.equal(await store('return p.solvedVisitCount.value'), 1);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: empty targets, plan loading/switching, visit gem limits, invalid budgets, normalization, worker races, export freshness/download, manual tank, mocked save, disabled tank, retry, keyboard stars, desktop and mobile navigation. Screenshots: ${shots}`
  );
} catch (err) {
  console.log('STATUS', await status.innerText().catch(() => 'unavailable'));
  console.log(
    'RESULT',
    (
      await page
        .locator('#optimizer-result')
        .innerText()
        .catch(() => '')
    ).slice(0, 3000)
  );
  console.log(
    'PLAN',
    await store(
      'return {visit:p.activePlanVisit.value?.visitId,settings:p.activeVisitSettings.value,solved:p.solvedVisitCount.value}'
    ).catch(() => null)
  );
  console.log('ERRORS', errors);
  await page.screenshot({ path: `${shots}/failure.png` });
  throw err;
} finally {
  await browser.close();
}

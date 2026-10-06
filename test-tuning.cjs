'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('C:/Users/Admini/.workbuddy/binaries/node/workspace/node_modules/playwright');

const NODE = 'C:/Users/Admini/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = __dirname;
const CONFIG_KEY = 'dung-balance-v1';
const META_KEY = 'dung-life-expedition-v2';
const changes = {
  'run.baseTime': 90, 'run.hardLimit': 75, 'stage.0.count': 3,
  'collect.goldAroma': 2, 'world.normalCount': 40, 'world.goldCount': 8,
  'move.walk': 6, 'move.dash': 11,
};
const result = {
  startedAt: new Date().toISOString(),
  environment: { node: process.execPath, requiredNode: NODE, edge: EDGE, transport: 'file://', viewport: '390x844', desktopViewport: '1440x1000' },
  scope: '真实 UI 导出/导入、开局/选卡/领奖及默认 JSON/HTML 交付；规则收益、硬时限、中断恢复采集统计与成就达标使用明确标注的 hook/fixture，不声称自然通关。',
  tests: [], pageErrors: [], dialogs: [], httpRequests: [], blockedRequests: [], httpResponses: [], artifacts: [],
};
let browser, tuning, game, downloadedBuffer, downloadedConfig, revision, defaults, firstSnapshot, initialMeta, settledEnvelope;
const protectedFiles = ['config.js', 'rogue.js', 'expedition.js', 'main.js', 'tuning.js', 'index.html', 'styles.css', 'tuning.html', 'tuning.css', 'build-game.cjs'];
const digest = name => createHash('sha256').update(fs.readFileSync(path.join(ROOT, name))).digest('hex');
const sourceHashes = Object.fromEntries(protectedFiles.map(name => [name, digest(name)]));

async function test(name, kind, fn) {
  const started = Date.now();
  try {
    const evidence = await fn();
    result.tests.push({ name, kind, status: 'passed', ms: Date.now() - started, evidence: evidence ?? null });
    console.log(`通过 | ${name}`);
    return true;
  } catch (error) {
    result.tests.push({ name, kind, status: 'failed', ms: Date.now() - started, error: error.message, stack: error.stack });
    console.error(`失败 | ${name} | ${error.message}`);
    return false;
  }
}
function requireDownload() {
  assert.ok(downloadedBuffer && downloadedConfig && revision, '前置条件失败：尚未获得有效的真实下载 JSON');
}
async function readDownload(page, button) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
  assert.equal(await download.failure(), null, '浏览器下载不能失败');
  const stream = await download.createReadStream();
  assert.ok(stream, '下载必须提供可读取的流');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), filename: download.suggestedFilename() };
}
async function newPage(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  await context.route(/^https?:\/\//i, async route => {
    result.blockedRequests.push({ page: label, url: route.request().url() });
    await route.abort('blockedbyclient');
  });
  context.on('request', request => {
    if (/^https?:/i.test(request.url())) result.httpRequests.push({ page: label, url: request.url() });
  });
  context.on('response', response => {
    if (/^https?:/i.test(response.url())) result.httpResponses.push({ page: label, url: response.url(), status: response.status() });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => result.pageErrors.push({ page: label, message: error.message, stack: error.stack }));
  page.on('dialog', async dialog => {
    result.dialogs.push({ page: label, type: dialog.type(), message: dialog.message() });
    try { await dialog.accept(); } catch (error) { result.pageErrors.push({ page: label, message: `接受对话框失败：${error.message}` }); }
  });
  return page;
}
async function open(page, filename, hook) {
  const url = pathToFileURL(path.join(ROOT, filename));
  url.search = '?test=1';
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(key => Boolean(window[key]), hook);
  assert.ok(page.url().startsWith('file:'), '只能通过本机 file:// 打开');
}
async function reloadGame() {
  await game.reload({ waitUntil: 'load' });
  await game.waitForFunction(() => Boolean(window.__game));
}
async function openCamp() {
  if (await game.evaluate(() => __game.state.mode !== 'camp')) await game.locator('#campBtn').click();
  assert.equal(await game.evaluate(() => __game.state.mode), 'camp');
}
async function atomicSnapshot() {
  return game.evaluate(() => ({
    config: __game.Config.export(), revision: __game.Config.revision,
    configStorage: localStorage.getItem('dung-balance-v1'), metaStorage: localStorage.getItem('dung-life-expedition-v2'),
    envelope: __game.expedition.getEnvelope(), pickups: __game.pickups.map(p => ({ ...p })),
  }));
}
async function reachable(selector) {
  const element = game.locator(selector);
  await element.scrollIntoViewIfNeeded();
  assert.equal(await element.isVisible(), true, `${selector} 必须可见`);
  const box = await element.boundingBox();
  assert.ok(box && box.y >= -1 && box.y + box.height <= 845 && box.x >= -1 && box.x + box.width <= 391,
    `${selector} 必须通过营地滚动完整进入 390x844 视口，实际 ${JSON.stringify(box)}`);
  return box;
}
async function screenshot(page, filename) {
  await page.screenshot({ path: path.join(ROOT, filename), animations: 'disabled' });
  if (!result.artifacts.includes(filename)) result.artifacts.push(filename);
}

async function main() {
  const built = await test('使用指定 managed Node 构建离线双文件', '构建', async () => {
    assert.equal(path.resolve(process.execPath).toLowerCase(), path.resolve(NODE).toLowerCase(), '请使用指定 managed Node 运行本脚本');
    const output = execFileSync(NODE, [path.join(ROOT, 'build-game.cjs')], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    for (const filename of ['数值调参台.html', '小小推球家-生命远征.html']) assert.ok(fs.statSync(path.join(ROOT, filename)).size > 1000);
    return { output: output.trim() };
  });
  assert.ok(built, '构建失败，不继续运行旧离线包');
  browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--allow-file-access-from-files'] });
  result.environment.browser = browser.version();
  tuning = await newPage('调参台');
  game = await newPage('游戏');
  await open(tuning, '数值调参台.html', '__tuning');
  await open(game, '小小推球家-生命远征.html', '__game');

  await test('Config.fields 与调参台表格完整对应 181 项', 'UI/API', async () => {
    const fields = await game.evaluate(() => __game.Config.fields.map(f => ({ key: f.key, default: f.default })));
    const tableKeys = await tuning.locator('#configRows tr').evaluateAll(rows => rows.map(row => row.dataset.key));
    const draft = await tuning.evaluate(() => __tuning.getDraft());
    defaults = await game.evaluate(() => ({ format: 'dung-balance-1', version: 1, values: { ...__game.Config.defaults } }));
    assert.deepEqual(defaults.values, Object.fromEntries(fields.map(f => [f.key, f.default])));
    initialMeta = await game.evaluate(() => __game.expedition.getEnvelope());
    assert.equal(fields.length, 181);
    assert.deepEqual(tableKeys, fields.map(f => f.key));
    assert.deepEqual(Object.keys(draft.values), tableKeys);
    assert.deepEqual(draft, defaults);
    return { configFields: fields.length, tableRows: tableKeys.length };
  });

  for (const invalid of ['', 'abc', 'NaN']) {
    await test(`输入 ${JSON.stringify(invalid)} 禁止 JSON 与 HTML 导出`, 'UI', async () => {
      const input = tuning.locator('input[data-key="run.baseTime"]');
      try {
        await input.fill(invalid);
        assert.equal(await input.getAttribute('aria-invalid'), 'true');
        assert.equal(await tuning.locator('#exportConfigBtn').isDisabled(), true);
        assert.equal(await tuning.locator('#exportReportBtn').isDisabled(), true);
        const checked = await tuning.evaluate(() => __tuning.validate());
        assert.equal(checked.ok, false);
        assert.ok(checked.error);
        return checked;
      } finally { await input.fill(String(defaults.values['run.baseTime'])); }
    });
  }

  await test('通过真实字段输入修改八项并校验草稿', 'UI', async () => {
    for (const [key, value] of Object.entries(changes)) await tuning.locator(`input[data-key="${key}"]`).fill(String(value));
    await tuning.locator('#validateBtn').click();
    const draft = await tuning.evaluate(() => __tuning.getDraft());
    for (const [key, value] of Object.entries(changes)) assert.equal(draft.values[key], value, key);
    assert.ok(draft.values['run.baseTime'] <= draft.values['run.timeCap']);
    assert.equal(await tuning.locator('#exportConfigBtn').isEnabled(), true);
    return { values: changes, revisionText: await tuning.locator('#revision').innerText() };
  });
  await test('真实导出按钮下载 JSON 并读取 buffer 校验全部字段', '下载', async () => {
    const download = await readDownload(tuning, '#exportConfigBtn');
    downloadedBuffer = download.buffer;
    downloadedConfig = JSON.parse(download.buffer.toString('utf8'));
    assert.deepEqual(downloadedConfig, await tuning.evaluate(() => __tuning.getDraft()));
    for (const [key, value] of Object.entries(changes)) assert.equal(downloadedConfig.values[key], value, key);
    const checked = await tuning.evaluate(() => __tuning.validate());
    assert.equal(checked.ok, true);
    revision = checked.revision;
    result.exportedRevision = revision;
    assert.equal(Object.keys(downloadedConfig.values).length, 181);
    return { filename: download.filename, bytes: download.buffer.length, revision, values: changes };
  });
  await test('真实按钮可导出包含全部字段的 HTML 汇总', '下载', async () => {
    requireDownload();
    const download = await readDownload(tuning, '#exportReportBtn');
    const report = download.buffer.toString('utf8');
    assert.match(report, /<!doctype html>/i);
    assert.ok(report.includes(revision));
    for (const key of Object.keys(downloadedConfig.values)) assert.ok(report.includes(key), `报告缺少 ${key}`);
    assert.match(report, /非 Monte Carlo/);
    return { filename: download.filename, bytes: download.buffer.length, revision };
  });

  for (const invalid of ['unknown', 'missing', 'negative', 'NaN', 'cross-field']) {
    await test(`调参台 importConfig 原子拒绝 ${invalid}`, '测试辅助/API', async () => {
      const observed = await tuning.evaluate(kind => {
        const before = { draft: __tuning.getDraft(), cache: localStorage.getItem('dung-tuning-draft-v1'), revision: document.getElementById('revision').textContent };
        const bad = structuredClone(before.draft);
        if (kind === 'unknown') bad.values['unknown.field'] = 1;
        if (kind === 'missing') delete bad.values['run.baseTime'];
        if (kind === 'negative') bad.values['run.baseTime'] = -1;
        if (kind === 'NaN') bad.values['run.baseTime'] = NaN;
        if (kind === 'cross-field') bad.values['run.baseTime'] = bad.values['run.timeCap'] + 1;
        let response;
        try { response = __tuning.importConfig(bad); } catch (error) { response = { ok: false, error: error.message }; }
        const after = { draft: __tuning.getDraft(), cache: localStorage.getItem('dung-tuning-draft-v1'), revision: document.getElementById('revision').textContent };
        return { before, after, response };
      }, invalid);
      assert.equal(observed.response.ok, false);
      assert.ok(observed.response.error);
      assert.deepEqual(observed.after, observed.before, '失败不得修改草稿、applied revision 或缓存');
      return observed.response;
    });
  }
  await test('调参台刷新保留编辑且手机无 body 横向溢出', '手机 UI', async () => {
    requireDownload();
    await tuning.reload();
    await tuning.waitForFunction(() => Boolean(window.__tuning));
    assert.deepEqual(await tuning.evaluate(() => __tuning.getDraft()), downloadedConfig);
    await tuning.setViewportSize({ width: 390, height: 844 });
    const sizes = await tuning.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth, table: document.querySelector('#configRows').closest('table').scrollWidth }));
    assert.ok(sizes.body <= sizes.viewport + 1, JSON.stringify(sizes));
    assert.ok(sizes.document <= sizes.viewport + 1, JSON.stringify(sizes));
    await tuning.locator('#onlyChanged').check();
    assert.equal(await tuning.locator('#configRows tr:visible').count(), Object.keys(changes).length);
    await tuning.locator('.workbench').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await screenshot(tuning, '调参台-实机.png');
    return sizes;
  });

  await test('营地真实文件 input 接收下载 buffer，确认后配置立即生效', 'UI 文件导入', async () => {
    requireDownload();
    await openCamp();
    const dialogsBefore = result.dialogs.length;
    await game.locator('#configImportInput').setInputFiles({ name: '生命远征-数值配置.json', mimeType: 'application/json', buffer: downloadedBuffer });
    await game.waitForFunction(expected => __game.Config.revision === expected && !document.getElementById('configImportBtn').disabled, revision);
    const actual = await game.evaluate(() => ({ config: __game.Config.export(), revision: __game.Config.revision, normal: __game.pickups.filter(p => !p.gold).length, gold: __game.pickups.filter(p => p.gold).length, envelope: __game.expedition.getEnvelope() }));
    assert.deepEqual(actual.config, downloadedConfig);
    assert.equal(actual.revision, revision);
    assert.equal(actual.normal, 40);
    assert.equal(actual.gold, 8);
    assert.deepEqual(actual.envelope, initialMeta, '导入配置不得清空或改变玩家进度');
    assert.ok(result.dialogs.slice(dialogsBefore).some(d => d.type === 'confirm' && d.message.includes('配置已完整校验')));
    assert.ok((await game.locator('#configStatus').innerText()).includes(revision));
    return { revision: actual.revision, normal: actual.normal, gold: actual.gold, playerUnchanged: true };
  });

  for (const target of ['Config.apply', 'expedition.applyConfig']) {
    for (const invalid of ['unknown', 'missing', 'negative', 'NaN', 'accessor', 'cross-field']) {
      await test(`${target} 原子拒绝 ${invalid}`, '测试辅助/API', async () => {
        const before = await atomicSnapshot();
        const response = await game.evaluate(({ target, kind }) => {
          const bad = __game.Config.export();
          if (kind === 'unknown') bad.values['unknown.field'] = 1;
          if (kind === 'missing') delete bad.values['run.baseTime'];
          if (kind === 'negative') bad.values['run.baseTime'] = -1;
          if (kind === 'NaN') bad.values['run.baseTime'] = NaN;
          if (kind === 'cross-field') bad.values['run.baseTime'] = bad.values['run.timeCap'] + 1;
          let getterCalls = 0;
          if (kind === 'accessor') Object.defineProperty(bad.values, 'run.baseTime', { enumerable: true, get() { getterCalls++; return 90; } });
          let response;
          try {
            response = target === 'Config.apply' ? { ok: true, value: __game.Config.apply(bad) } : __game.expedition.applyConfig(bad);
          } catch (error) { response = { ok: false, error: error.message }; }
          return { ...response, getterCalls };
        }, { target, kind: invalid });
        assert.equal(response.ok, false);
        assert.ok(response.error);
        assert.equal(response.getterCalls, 0, '校验不能执行输入访问器');
        assert.deepEqual(await atomicSnapshot(), before, '失败后配置、revision、存储、玩家进度与拾取物必须不变');
        return response;
      });
    }
  }
  await test('模拟 localStorage.setItem 失败，合法配置也原子拒绝', '存储故障注入', async () => {
    const before = await atomicSnapshot();
    const response = await game.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
      let attempts = 0;
      Object.defineProperty(Storage.prototype, 'setItem', { ...original, value(key, value) {
        if (key === 'dung-balance-v1') { attempts++; throw new DOMException('测试 fixture：存储配额不足', 'QuotaExceededError'); }
        return original.value.call(this, key, value);
      } });
      try {
        const next = __game.Config.export();
        next.values['run.baseTime'] = 91;
        return { response: __game.expedition.applyConfig(next), attempts };
      } finally { Object.defineProperty(Storage.prototype, 'setItem', original); }
    });
    assert.equal(response.attempts, 1);
    assert.equal(response.response.ok, false);
    assert.match(response.response.error, /配额不足/);
    assert.deepEqual(await atomicSnapshot(), before);
    return response;
  });
  await test('配置刷新持久化且玩家存档独立不清空', '持久化', async () => {
    requireDownload();
    const before = await game.evaluate(() => ({ envelope: __game.expedition.getEnvelope(), configText: localStorage.getItem('dung-balance-v1'), metaText: localStorage.getItem('dung-life-expedition-v2') }));
    await reloadGame();
    const after = await game.evaluate(() => ({ envelope: __game.expedition.getEnvelope(), configText: localStorage.getItem('dung-balance-v1'), metaText: localStorage.getItem('dung-life-expedition-v2') }));
    assert.deepEqual(after, before);
    assert.deepEqual(await game.evaluate(() => __game.Config.export()), downloadedConfig);
    assert.equal(await game.evaluate(() => __game.Config.revision), revision);
    return { revision, separateKeys: [CONFIG_KEY, META_KEY] };
  });

  await test('真实种子 UI 输入 123 后开局，runSeed 必须等于 123', 'UI', async () => {
    await openCamp();
    await game.locator('#trialSeed').fill('123');
    await game.locator('#campClose').click();
    await game.locator('#startBtn').click();
    await game.waitForFunction(() => __game.state.mode === 'draft');
    const observed = await game.evaluate(() => ({ input: document.getElementById('trialSeed').value, runSeed: __game.state.runSeed, startedSeed: __game.expedition.meta.activeRun.startedSeed, pickups: __game.pickups.map(p => ({ ...p })) }));
    firstSnapshot = observed.pickups;
    result.seedObservation = { ui: observed.input, runSeed: observed.runSeed, startedSeed: observed.startedSeed };
    assert.equal(observed.runSeed, 123, `种子 UI 为 123，但 runSeed=${observed.runSeed}；main.js start() 在 createPickups() 推进共享 seed 后才 expedition.begin(seed)`);
    assert.equal(observed.startedSeed, 123);
    return result.seedObservation;
  });
  await test('开局倒计时、阶段目标及 40/8 拾取物实际读取新配置', 'UI/API', async () => {
    requireDownload();
    const actual = await game.evaluate(() => ({ mode: __game.state.mode, time: __game.state.time, elapsed: __game.state.elapsed, targets: __game.Rogue.targets, normal: __game.pickups.filter(p => !p.gold).length, gold: __game.pickups.filter(p => p.gold).length, totalUI: document.getElementById('deliveryTotal').textContent, walk: __game.Config.get('move.walk'), dash: __game.Config.get('move.dash') }));
    assert.equal(actual.mode, 'draft');
    assert.equal(actual.time, 90);
    assert.equal(actual.elapsed, 0, '选卡期间活跃时间不流逝');
    actual.targets.forEach((target, index) => {
      for (const key of ['mass', 'aroma', 'count']) assert.equal(target[key], downloadedConfig.values[`stage.${index}.${key}`]);
    });
    assert.equal(actual.totalUI, '3');
    assert.equal(actual.normal, 40); assert.equal(actual.gold, 8);
    assert.equal(actual.walk, 6); assert.equal(actual.dash, 11);
    return actual;
  });
  await test('真实选卡后局中 applyConfig 拒绝且营地导入/重置控件禁用', 'UI/API', async () => {
    assert.equal(await game.locator('#campBtn').isDisabled(), true, '选卡期间营地入口禁用');
    const card = game.locator('[data-perk]').first();
    const perk = await card.getAttribute('data-perk');
    await card.click();
    assert.equal(await game.evaluate(() => __game.state.mode), 'playing');
    assert.equal(await game.evaluate(id => __game.state.perks[id], perk), 1);
    await openCamp();
    for (const id of ['configImportBtn', 'configImportInput', 'configResetBtn', 'trialSeed']) assert.equal(await game.locator(`#${id}`).isDisabled(), true, `${id} 局中必须禁用`);
    const before = await atomicSnapshot();
    const response = await game.evaluate(() => {
      const next = __game.Config.export(); next.values['run.baseTime'] = 91;
      return __game.expedition.applyConfig(next);
    });
    assert.equal(response.ok, false); assert.match(response.error, /远征尚未结束/);
    assert.deepEqual(await atomicSnapshot(), before);
    return { selectedPerk: perk, response, lockedControls: ['configImportBtn', 'configImportInput', 'configResetBtn', 'trialSeed'] };
  });
  await test('金色香气配置 2 经真实 Rogue.collect 规则链路生效', '规则 hook（非自然拾取）', async () => {
    const actual = await game.evaluate(() => {
      const { Rogue, Config } = __game;
      const fixture = {}; Rogue.initRun(fixture, Rogue.freshMeta(), 123);
      const before = { aroma: fixture.aroma, pocket: fixture.pocket, mass: fixture.mass };
      const gain = Rogue.collect(fixture, 0, true);
      return { before, after: { aroma: fixture.aroma, pocket: fixture.pocket, mass: fixture.mass }, gain, expectedFood: Config.get('collect.goldFood') };
    });
    assert.equal(actual.gain.aromaGain, 2);
    assert.equal(actual.after.aroma - actual.before.aroma, 2);
    assert.equal(actual.after.pocket - actual.before.pocket, actual.expectedFood);
    assert.equal(actual.after.mass, actual.before.mass);
    return { ...actual, fixture: '独立规则状态，不伪称玩家自然采集或通关' };
  });
  await test('Rogue.tick 与 simulate 在累计 75 秒触发硬上限结算', '规则/主层 hook（模拟时间）', async () => {
    const actual = await game.evaluate(() => {
      const g = __game;
      const fixture = {}; g.Rogue.initRun(fixture, g.Rogue.freshMeta(), 123);
      g.Rogue.tick(fixture, 74.75);
      const beforeLimit = { elapsed: fixture.elapsed, time: fixture.time, hardTimedOut: fixture.hardTimedOut };
      g.Rogue.select(fixture, 'clock', ['clock']);
      g.Rogue.tick(fixture, 0.25);
      const atLimit = { elapsed: fixture.elapsed, time: fixture.time, hardTimedOut: fixture.hardTimedOut };
      g.state.elapsed = 74.75; g.state.time = g.Config.get('run.timeCap');
      g.setMode('playing'); g.simulate(0.25, 75); g.updateHUD();
      return { beforeLimit, atLimit, mode: g.state.mode, elapsed: g.state.elapsed, time: g.state.time, hardTimedOut: g.state.hardTimedOut, settled: g.state.settled, result: g.state.result, activeRun: g.expedition.meta.activeRun, title: document.getElementById('endTitle').textContent, stats: document.getElementById('endStats').textContent };
    });
    assert.equal(actual.beforeLimit.hardTimedOut, false); assert.ok(actual.beforeLimit.time > 0);
    assert.deepEqual(actual.atLimit, { elapsed: 75, time: 0, hardTimedOut: true });
    assert.equal(actual.mode, 'ended'); assert.equal(actual.elapsed, 75); assert.equal(actual.time, 0);
    assert.equal(actual.hardTimedOut, true); assert.equal(actual.settled, true); assert.equal(actual.activeRun, null);
    assert.equal(actual.result.outcome, 'fail'); assert.equal(actual.result.reasonLabel, '累计时长上限');
    assert.match(actual.title, /累计时长/); assert.match(actual.stats, /75 秒上限/);
    settledEnvelope = await game.evaluate(() => __game.expedition.getEnvelope());
    return actual;
  });
  await test('同一真实种子 UI 重开产生相同完整初始化 pickup 快照', 'UI 确定性', async () => {
    assert.ok(firstSnapshot, '首次开局未生成初始化快照');
    assert.equal(await game.evaluate(() => __game.state.mode), 'ended');
    await game.locator('#homeBtn').click();
    await openCamp(); await game.locator('#trialSeed').fill('123'); await game.locator('#campClose').click();
    await game.locator('#startBtn').click();
    await game.waitForFunction(() => __game.state.mode === 'draft');
    const second = await game.evaluate(() => __game.pickups.map(p => ({ ...p })));
    assert.deepEqual(second, firstSnapshot, '同 seed 的位置、类型、质量、相位及初始活跃状态必须相同');
    return { count: second.length, sha256: createHash('sha256').update(JSON.stringify(second)).digest('hex'), note: '只证明同 UI 输入初始化可复现，不能替代 runSeed=123 的独立断言' };
  });
  await test('真实选卡与撤离结束第二局，刷新保留已结算进度', 'UI 持久化', async () => {
    await game.locator('[data-perk]').first().click();
    await game.locator('#pauseBtn').click(); await game.locator('#retreatBtn').click();
    assert.equal(await game.evaluate(() => __game.state.result.outcome), 'retreat');
    settledEnvelope = await game.evaluate(() => __game.expedition.getEnvelope());
    await reloadGame();
    assert.deepEqual(await game.evaluate(() => __game.expedition.getEnvelope()), settledEnvelope);
    assert.equal(await game.evaluate(() => __game.Config.revision), revision);
    return { runs: settledEnvelope.meta.runs, food: settledEnvelope.meta.food, revision };
  });

  await test('新局规则采集 7 次 checkpoint 后 reload 累计统计且再次 reload 不重复', '统计 hook（非自然采集）', async () => {
    const before = await game.evaluate(() => __game.expedition.getEnvelope());
    assert.equal(before.meta.activeRun, null, '必须从无 active 的已结算状态开启新局');
    assert.equal(before.journal, null);
    const checkpoint = await game.evaluate(() => {
      const g = __game;
      g.start();
      // 暂停主循环，只执行规则采集，避免自然拾取或计时影响精确统计。
      g.setMode('paused');
      const initialCollected = g.state.collected;
      const gains = Array.from({ length: 7 }, () => g.Rogue.collect(g.state, 1, false));
      g.expedition.checkpoint();
      return {
        initialCollected, collected: g.state.collected, settled: g.state.settled,
        draftEvery: g.Config.get('run.draftEvery'), gains,
        envelope: g.expedition.getEnvelope(),
        saved: JSON.parse(localStorage.getItem('dung-life-expedition-v2')),
      };
    });
    assert.equal(checkpoint.initialCollected, 0);
    assert.equal(checkpoint.collected, 7);
    assert.equal(checkpoint.settled, false);
    assert.equal(checkpoint.draftEvery, 12);
    assert.ok(checkpoint.gains.every(gain => gain.massGain > 0 && gain.levelUp === false), '7 次普通规则采集不触发第 12 次选卡');
    assert.ok(checkpoint.envelope.meta.activeRun);
    assert.equal(checkpoint.envelope.journal.collected, 7);
    assert.equal(checkpoint.envelope.meta.stats.collected, before.meta.stats.collected, 'checkpoint 不提前累计已结算统计');
    assert.equal(checkpoint.envelope.meta.runs, before.meta.runs);
    assert.deepEqual(checkpoint.saved, checkpoint.envelope, 'checkpoint 必须把含 collected 的 journal 写入真实存储');
    await reloadGame();
    const recovered = await game.evaluate(() => ({ envelope: __game.expedition.getEnvelope(), saved: JSON.parse(localStorage.getItem('dung-life-expedition-v2')) }));
    assert.equal(recovered.envelope.meta.stats.collected, before.meta.stats.collected + 7);
    assert.equal(recovered.envelope.meta.runs, before.meta.runs + 1);
    assert.equal(recovered.envelope.meta.activeRun, null);
    assert.equal(recovered.envelope.journal, null);
    assert.deepEqual(recovered.saved, recovered.envelope, '中断结算必须落盘并清除 active/journal');
    await reloadGame();
    const repeated = await game.evaluate(() => ({ envelope: __game.expedition.getEnvelope(), saved: JSON.parse(localStorage.getItem('dung-life-expedition-v2')) }));
    assert.deepEqual(repeated, recovered, '第二次 reload 不得重复累计采集、局数或其他结算收益');
    return {
      fixture: '复用游戏页面，以 start/暂停 hook 新开局并执行 Rogue.collect 7 次，非自然采集',
      before: { collected: before.meta.stats.collected, runs: before.meta.runs },
      checkpoint: checkpoint.envelope.journal,
      firstReload: { collected: recovered.envelope.meta.stats.collected, runs: recovered.envelope.meta.runs },
      secondReload: { collected: repeated.envelope.meta.stats.collected, runs: repeated.envelope.meta.runs },
    };
  });

  await test('旧 meta 缺少 stats/claimed 可由 validEnvelope 兼容且不伪造统计', '旧存档 fixture', async () => {
    const actual = await game.evaluate(() => {
      const legacy = __game.expedition.getEnvelope();
      legacy.meta.wins = 2; legacy.meta.offspring = 4; delete legacy.meta.stats; delete legacy.meta.claimed;
      const before = JSON.stringify(legacy), liveBefore = JSON.stringify(__game.expedition.getEnvelope());
      const migrated = __game.expedition.validEnvelope(legacy);
      return { migrated, inputUnchanged: JSON.stringify(legacy) === before, liveUnchanged: JSON.stringify(__game.expedition.getEnvelope()) === liveBefore };
    });
    assert.equal(actual.inputUnchanged, true); assert.equal(actual.liveUnchanged, true);
    assert.deepEqual(actual.migrated.meta.stats, { collected: 0, banked: 0, bestWinSeconds: null });
    assert.deepEqual(actual.migrated.meta.claimed, []); assert.equal(actual.migrated.meta.wins, 2); assert.equal(actual.migrated.meta.offspring, 4);
    return actual;
  });
  await test('通过真实存档 input 导入成就达标 fixture，六成就可见', 'fixture + UI', async () => {
    await openCamp();
    const fixture = await game.evaluate(() => {
      const envelope = __game.expedition.getEnvelope(), C = key => __game.Config.get(key);
      envelope.meta.wins = Math.max(C('achievements.first_win.target'), C('achievements.veteran.target'));
      envelope.meta.runs = Math.max(envelope.meta.runs, envelope.meta.wins);
      envelope.meta.offspring = C('achievements.family.target');
      envelope.meta.stats = { collected: C('achievements.collector.target'), banked: C('achievements.banker.target'), bestWinSeconds: Math.min(60, C('achievements.swift.target')) };
      envelope.meta.claimed = []; envelope.meta.activeRun = null; envelope.journal = null;
      envelope.logs = ['测试 fixture：仅为成就领奖回归，非真实自然通关记录。'];
      return envelope;
    });
    const dialogCount = result.dialogs.length;
    await game.locator('#importSaveInput').setInputFiles({ name: '成就测试fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await game.waitForFunction(() => __game.expedition.getEnvelope().logs[0]?.startsWith('测试 fixture：'));
    assert.deepEqual(await game.evaluate(() => __game.expedition.getEnvelope()), fixture);
    assert.equal(await game.locator('#achievementList .achievement-card').count(), 6);
    const achievements = await game.evaluate(() => __game.Rogue.achievements(__game.expedition.meta));
    assert.equal(achievements.length, 6);
    for (const achievement of achievements) {
      assert.equal(achievement.unlocked, true, achievement.id);
      assert.equal(await game.locator(`[data-achievement="${achievement.id}"]`).isVisible(), true);
      assert.equal(await game.locator(`[data-achievement="${achievement.id}"]`).isEnabled(), true);
    }
    assert.ok(result.dialogs.slice(dialogCount).some(d => d.type === 'confirm' && d.message.includes('恢复将覆盖')));
    return { fixture: fixture.meta, visible: achievements.map(a => a.id) };
  });
  for (const id of ['first_win', 'family', 'veteran', 'collector', 'banker', 'swift']) {
    await test(`真实 claim 按钮 ${id} 仅奖励一次并防重复`, 'UI + 重复点击防御', async () => {
      const before = await game.evaluate(id => ({ meta: structuredClone(__game.expedition.meta), achievement: __game.Rogue.achievements(__game.expedition.meta).find(a => a.id === id) }), id);
      const button = game.locator(`[data-achievement="${id}"]`);
      assert.equal(await button.isEnabled(), true);
      await button.click();
      const after = await game.evaluate(() => structuredClone(__game.expedition.meta));
      assert.equal(after.food, before.meta.food + before.achievement.food);
      assert.equal(after.genes, before.meta.genes + before.achievement.genes);
      assert.equal(after.claimed.filter(value => value === id).length, 1);
      assert.equal(await button.isDisabled(), true);
      assert.equal(await button.innerText(), '已领取');
      // 禁用控件不能真实再点击；分发合成事件额外验证委托处理器也阻止重领。
      await button.dispatchEvent('click');
      assert.deepEqual(await game.evaluate(() => structuredClone(__game.expedition.meta)), after);
      return { foodGain: after.food - before.meta.food, genesGain: after.genes - before.meta.genes, claimedOnce: true };
    });
  }
  await test('六成就已领与奖励在 reload 后持久化且仍不可重领', '持久化', async () => {
    const before = await game.evaluate(() => __game.expedition.getEnvelope());
    assert.equal(before.meta.claimed.length, 6);
    await reloadGame(); await openCamp();
    assert.deepEqual(await game.evaluate(() => __game.expedition.getEnvelope()), before);
    for (const id of before.meta.claimed) assert.equal(await game.locator(`[data-achievement="${id}"]`).isDisabled(), true);
    return { claimed: before.meta.claimed, food: before.meta.food, genes: before.meta.genes };
  });
  await test('手机营地滚动可达六成就及配置控件并保存实机截图', '手机 UI', async () => {
    await game.setViewportSize({ width: 390, height: 844 });
    await openCamp();
    const boxes = {};
    for (const id of ['first_win', 'family', 'veteran', 'collector', 'banker', 'swift']) boxes[id] = await reachable(`[data-achievement="${id}"]`);
    for (const id of ['configTitle', 'configImportBtn', 'configExportBtn', 'configResetBtn', 'trialSeed']) boxes[id] = await reachable(`#${id}`);
    const scroll = await game.locator('.camp-panel').evaluate(el => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    assert.ok(scroll.scrollHeight > scroll.clientHeight && scroll.scrollTop > 0, '必须实际滚动营地内部面板');
    await game.locator('#configTitle').scrollIntoViewIfNeeded();
    await screenshot(game, '配置成就-实机.png');
    return { boxes, scroll, viewport: '390x844' };
  });

  await test('真实恢复默认配置按钮保留玩家进度及六条已领记录', 'UI', async () => {
    const before = await game.evaluate(() => __game.expedition.getEnvelope());
    const dialogsBefore = result.dialogs.length;
    await game.locator('#configResetBtn').click();
    assert.deepEqual(await game.evaluate(() => __game.Config.export()), defaults);
    assert.deepEqual(await game.evaluate(() => __game.expedition.getEnvelope()), before);
    const counts = await game.evaluate(() => ({ normal: __game.pickups.filter(p => !p.gold).length, gold: __game.pickups.filter(p => p.gold).length }));
    assert.equal(counts.normal, defaults.values['world.normalCount']); assert.equal(counts.gold, defaults.values['world.goldCount']);
    assert.ok(result.dialogs.slice(dialogsBefore).some(d => d.type === 'confirm' && d.message.includes('恢复默认数值配置')));
    await reloadGame();
    assert.deepEqual(await game.evaluate(() => __game.Config.export()), defaults);
    assert.deepEqual(await game.evaluate(() => __game.expedition.getEnvelope()), before);
    return { counts, playerUnchanged: true, claimed: before.meta.claimed };
  });
  await test('真实调参台恢复默认仅重置草稿，不改最近 applied 快照', 'UI', async () => {
    const beforeApplied = (await tuning.locator('#revision').innerText()).match(/applied ([0-9a-f]+)/)?.[1];
    await tuning.locator('#resetAllBtn').click();
    assert.deepEqual(await tuning.evaluate(() => __tuning.getDraft()), defaults);
    assert.equal((await tuning.locator('#revision').innerText()).match(/applied ([0-9a-f]+)/)?.[1], beforeApplied);
    assert.equal(await tuning.locator('#exportConfigBtn').isEnabled(), true);
    return { previousApplied: beforeApplied, draftRestored: true };
  });
  await test('真实 UI 导出默认 JSON，全部字段严格等于 Config.defaults', '默认产物 / UI 下载', async () => {
    assert.deepEqual(await tuning.evaluate(() => __tuning.getDraft()), defaults);
    const download = await readDownload(tuning, '#exportConfigBtn');
    const config = JSON.parse(download.buffer.toString('utf8'));
    assert.deepEqual(config, defaults, '交付 JSON 不得混入测试八项改值');
    assert.deepEqual(config.values, await game.evaluate(() => ({ ...__game.Config.defaults })));
    for (const key of Object.keys(changes)) assert.notEqual(config.values[key], changes[key], `${key} 必须恢复默认`);
    const defaultRevision = await game.evaluate(() => __game.Config.revision);
    assert.ok((await tuning.locator('#revision').innerText()).includes(`applied ${defaultRevision}`));
    const filename = '生命远征-默认数值.json';
    fs.writeFileSync(path.join(ROOT, filename), download.buffer);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, filename), 'utf8')), defaults);
    result.artifacts.push(filename);
    result.defaultRevision = defaultRevision;
    return { filename, suggestedFilename: download.filename, fields: Object.keys(config.values).length, revision: defaultRevision, bytes: download.buffer.length, sha256: createHash('sha256').update(download.buffer).digest('hex') };
  });
  await test('真实 UI 导出默认 HTML 汇总，逐行核验当前值与默认值', '默认产物 / UI 下载', async () => {
    assert.deepEqual(await tuning.evaluate(() => __tuning.getDraft()), defaults);
    const download = await readDownload(tuning, '#exportReportBtn');
    const html = download.buffer.toString('utf8');
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /非 Monte Carlo/);
    const defaultRevision = await game.evaluate(() => __game.Config.revision);
    assert.ok(html.includes(`配置 revision：${defaultRevision}`));
    const rows = await tuning.evaluate(text => {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      return [...doc.querySelectorAll('.report-scroll tbody tr')].map(row => [...row.cells].map(cell => cell.textContent));
    }, html);
    assert.equal(rows.length, Object.keys(defaults.values).length);
    assert.deepEqual(rows.map(row => row[0]), Object.keys(defaults.values));
    for (const [key, , current, baseline] of rows) {
      assert.equal(current, String(defaults.values[key]), `${key} 汇总当前值必须为默认`);
      assert.equal(baseline, String(defaults.values[key]), `${key} 汇总默认值必须为默认`);
    }
    const filename = '生命远征-数值总览.html';
    fs.writeFileSync(path.join(ROOT, filename), download.buffer);
    assert.deepEqual(fs.readFileSync(path.join(ROOT, filename)), download.buffer);
    result.artifacts.push(filename);
    return { filename, suggestedFilename: download.filename, fields: rows.length, revision: defaultRevision, bytes: download.buffer.length, sha256: createHash('sha256').update(download.buffer).digest('hex') };
  });
  await test('默认数值工作台桌面 1440x1000 展示分组侧栏与可编辑字段', '桌面 UI / 截图', async () => {
    await tuning.setViewportSize({ width: 1440, height: 1000 });
    await tuning.locator('#fieldsTab').click();
    await tuning.locator('#onlyChanged').uncheck();
    await tuning.locator('#searchInput').fill('');
    await tuning.locator('#groupNav button').first().click();
    await tuning.locator('.table-scroll').evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
    await tuning.locator('.tabs').evaluate(el => el.scrollIntoView({ block: 'start' }));
    assert.equal(await tuning.locator('#fieldsTab').getAttribute('aria-selected'), 'true');
    assert.equal(await tuning.locator('#fieldsPanel').isVisible(), true);
    assert.equal(await tuning.locator('#configRows tr:visible').count(), Object.keys(defaults.values).length);
    assert.equal(await tuning.locator('#changedCount').innerText(), '0');
    assert.deepEqual(await tuning.evaluate(() => __tuning.getDraft()), defaults);
    const boxes = {};
    for (const selector of ['.group-sidebar h3', '#groupNav button:first-child', '#configTable thead', 'input[data-key="run.baseTime"]', 'input[data-key="run.hardLimit"]']) {
      const element = tuning.locator(selector);
      assert.equal(await element.isVisible(), true, `${selector} 必须可见`);
      const box = await element.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1441 && box.y + box.height <= 1001, `${selector} 必须完整进入桌面视口：${JSON.stringify(box)}`);
      boxes[selector] = box;
    }
    assert.ok(boxes['.group-sidebar h3'].x < boxes['input[data-key="run.baseTime"]'].x, '分组侧栏必须位于数值字段左侧');
    await tuning.evaluate(() => document.fonts.ready);
    await screenshot(tuning, '数值调参台-桌面.png');
    const png = fs.readFileSync(path.join(ROOT, '数值调参台-桌面.png'));
    assert.equal(png.readUInt32BE(16), 1440);
    assert.equal(png.readUInt32BE(20), 1000);
    return { filename: '数值调参台-桌面.png', viewport: '1440x1000', defaults: true, boxes };
  });
}

(async () => {
  try { await main(); }
  catch (error) {
    result.tests.push({ name: '测试基础设施与主流程可执行', kind: '基础设施', status: 'failed', error: error.message, stack: error.stack });
    console.error(error.stack);
  } finally {
    for (const [page, filename] of [[tuning, '调参台-实机.png'], [game, '配置成就-实机.png']]) {
      if (page && !page.isClosed() && !result.artifacts.includes(filename)) {
        await test(`${filename} 故障现场截图`, '诊断', async () => {
          await page.setViewportSize({ width: 390, height: 844 });
          await screenshot(page, filename);
          return { fallback: true, note: '前置流程未完成，截图仅作故障现场，不表示验收通过' };
        });
      }
    }
    if (browser) {
      await test('关闭本次独立浏览器会话', '基础设施', async () => { await browser.close(); });
    }
    await test('所有页面 pageerror 必须为 0', '错误监控', async () => {
      assert.deepEqual(result.pageErrors, [], JSON.stringify(result.pageErrors));
      return { count: 0 };
    });
    await test('双文件离线无 HTTP 外部请求且全部 HTTP 路由阻断', '离线网络', async () => {
      assert.deepEqual(result.httpRequests, [], '离线包不应尝试请求任何 HTTP(S) 资源');
      assert.deepEqual(result.httpResponses, [], '不得接收任何 HTTP(S) 响应');
      return { route: '/^https?:\\/\\//i → abort(blockedbyclient)', requests: result.httpRequests.length, blocked: result.blockedRequests.length, responses: result.httpResponses.length };
    });
    await test('测试未修改任何游戏/调参台源码或构建脚本', '修改范围', async () => {
      const after = Object.fromEntries(protectedFiles.map(name => [name, digest(name)]));
      assert.deepEqual(after, sourceHashes);
      return { protectedFiles, generatedByBuild: ['数值调参台.html', '小小推球家-生命远征.html'] };
    });
    result.finishedAt = new Date().toISOString();
    result.total = result.tests.length;
    result.passed = result.tests.filter(t => t.status === 'passed').length;
    result.failed = result.tests.filter(t => t.status === 'failed').length;
    result.failures = result.tests.filter(t => t.status === 'failed').map(({ name, error }) => ({ name, error }));
    result.exitCode = result.failed ? 1 : 0;
    fs.writeFileSync(path.join(ROOT, 'tuning-test-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ total: result.total, passed: result.passed, failed: result.failed, pageErrors: result.pageErrors.length, failures: result.failures, report: path.join(ROOT, 'tuning-test-results.json') }, null, 2));
  }
  if (result.failed) throw new Error(`端到端测试失败：${result.failed}/${result.total}；详见 tuning-test-results.json`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });

const { chromium } = require('C:/Users/Admini/.workbuddy/binaries/node/workspace/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 仅写本测试文件；结果输出到终端，不修改游戏、存档或随机种子。
const protectedFiles = ['main.js', 'rogue.js', 'expedition.js', 'index.html', 'styles.css'];
const hashes = () => Object.fromEntries(protectedFiles.map(name => [name,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex')]));

(async () => {
  const beforeHashes = hashes();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.GAME_URL || require('url').pathToFileURL(require('path').join(__dirname,'小小推球家-生命远征.html')).href+'?test=1');
    await page.waitForFunction(() => window.__game);
    const initialMeta = await page.evaluate(() => {
      const g = window.__game;
      return { ...JSON.parse(JSON.stringify(g.expedition.meta)), geneLevel: g.expedition.geneLevel };
    });
    if (Object.values(initialMeta.upgrades).some(Boolean) || initialMeta.geneLevel !== 0 || initialMeta.runs !== 0) {
      throw new Error('新浏览器上下文并非零升级初始存档，终止测试');
    }
    await page.click('#startBtn');
    const result = await page.evaluate(() => {
      const g = window.__game;
      const s = g.state;
      const dt = 1 / 30;
      const priority = ['magnet', 'growth', 'armor', 'vitality', 'swift', 'aroma', 'thorns', 'endurance', 'recovery', 'heal', 'clock', 'jump', 'bank', 'insurance', 'cash'];
      const snapshot = () => ({
        elapsed: s.elapsed, time: s.time, hp: s.hp, maxHp: s.maxHp, mode: s.mode,
        stage: s.stage, stageName: g.Rogue.target(s).name, stageDelivered: s.stageDelivered,
        delivered: s.delivered, mass: s.mass, aroma: s.aroma, collected: s.collected,
        score: s.score, hitCount: s.hitCount, trait: s.trait, perks: { ...s.perks },
        x: s.x, z: s.z, y: s.y, stamina: s.stamina, weather: s.weather,
      });
      const start = snapshot();
      const drafts = [], deliveries = [], hits = [], collectEvents = [], checkpoints = [], birdWarnings = [];
      let steps = 0, realNormal = 0, realGold = 0, jumpingForStuck = 0, dashSteps = 0;
      let dash = false, anchor = { x: s.x, z: s.z }, nextCheckpoint = 10;
      let dodge = null, blocked = null, lastTarget = null;
      // 同步执行整局，浏览器 RAF 无法在选卡及固定步长模拟之间插入推进。
      while (steps < 10000 && (steps + 1) * dt <= 250 && !s.settled) {
        if (s.mode === 'draft') {
          const offered = g.expedition.offered;
          const id = priority.find(item => offered.includes(item));
          const card = document.querySelector(`[data-perk="${id}"]`);
          if (!card || card.disabled) { blocked = '真实三选一按钮不存在或不可点击'; break; }
          drafts.push({ elapsed: s.elapsed, stage: s.stage, offered, selected: id });
          card.click();
          continue;
        }
        if (s.mode !== 'playing') { blocked = `非预期模式：${s.mode}`; break; }
        const goal = g.Rogue.target(s);
        const ready = g.Rogue.ready(s);
        if (ready && Math.hypot(s.x - g.nest.x, s.z - g.nest.z) <= 2.6 && s.y <= 0.5) {
          const before = snapshot();
          // E 键事件经过原有交付入口和距离、质量、香气校验。
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true }));
          deliveries.push({ before, after: snapshot(), accepted: s.delivered === before.delivered + 1 });
          if (s.delivered !== before.delivered + 1) { blocked = '达标且到巢后真实交付未接受'; break; }
          continue;
        }
        let target;
        if (ready) {
          target = { x: g.nest.x, z: g.nest.z, kind: 'nest' };
        } else {
          const needGold = s.aroma < goal.aroma;
          const candidates = g.pickups.filter(p => p.active && (needGold ? p.gold : !p.gold));
          candidates.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
          const p = candidates[0];
          target = p ? { x: p.x, z: p.z, kind: p.gold ? 'gold' : 'normal', index: p.index }
            : { x: g.nest.x, z: g.nest.z, kind: 'wait-respawn' };
        }
        if (s.birdWarning > 0) {
          if (!dodge) {
            let dx = s.x - s.birdX, dz = s.z - s.birdZ;
            if (Math.hypot(dx, dz) < 0.1) { dx = target.x - s.x; dz = target.z - s.z; }
            if (Math.hypot(dx, dz) < 0.1) { dx = 1; dz = 0; }
            const length = Math.hypot(dx, dz);
            dodge = { x: s.birdX + dx / length * 4.4, z: s.birdZ + dz / length * 4.4, kind: 'bird-dodge' };
            birdWarnings.push({ elapsed: s.elapsed, x: s.birdX, z: s.birdZ, dodge });
          }
          target = dodge;
        } else dodge = null;
        lastTarget = target;
        const dx = target.x - s.x, dz = target.z - s.z;
        const ix = 0.874 * dx - 0.486 * dz, iy = 0.486 * dx + 0.874 * dz;
        const main = Math.max(Math.abs(ix), Math.abs(iy));
        g.keys.clear();
        if (Math.hypot(dx, dz) > 0.2) {
          if (Math.abs(ix) > main * 0.35) g.keys.add(ix > 0 ? 'KeyD' : 'KeyA');
          if (Math.abs(iy) > main * 0.35) g.keys.add(iy > 0 ? 'KeyS' : 'KeyW');
        }
        if (s.stamina < 18) dash = false;
        if (s.stamina > 65) dash = true;
        if ((dash && Math.hypot(dx, dz) > 2) || (dodge && s.stamina > 12 && Math.hypot(s.x - s.birdX, s.z - s.birdZ) < 3.5)) {
          g.keys.add('ShiftLeft'); dashSteps++;
        }
        if (steps > 0 && steps % 15 === 0) {
          if (Math.hypot(s.x - anchor.x, s.z - anchor.z) < 0.22 && Math.hypot(dx, dz) > 0.5 && s.y <= 0.025) {
            g.jump(); jumpingForStuck++;
          }
          anchor = { x: s.x, z: s.z };
        }
        const activeBefore = g.pickups.map(p => p.active);
        const before = snapshot();
        g.simulate(dt, s.elapsed + dt);
        steps++;
        const collectedNow = g.pickups.filter((p, i) => activeBefore[i] && !p.active);
        for (const p of collectedNow) {
          if (p.gold) realGold++; else realNormal++;
          collectEvents.push({ elapsed: s.elapsed, gold: p.gold, index: p.index, x: p.x, z: p.z, value: p.value });
        }
        if (s.hitCount !== before.hitCount) hits.push({ before, after: snapshot(), notice: document.getElementById('toast').textContent });
        if (s.elapsed >= nextCheckpoint) { checkpoints.push(snapshot()); nextCheckpoint += 10; }
      }
      g.keys.clear();
      const final = snapshot();
      const victory = s.completed && s.settled && s.mode === 'ended' && s.result?.outcome === 'win' && s.delivered === 5;
      return {
        victory, stopReason: victory ? '真实交付五次并胜利结算' : blocked || s.result?.reasonLabel || '达到模拟上限',
        dt, steps, simulatedSeconds: steps * dt, start, final,
        realCollects: { normal: realNormal, gold: realGold, total: realNormal + realGold,
          matchesStateCollected: realNormal === s.collected - start.collected },
        jumpingForStuck, jumps: s.jumps, dashSteps, lastTarget,
        upgrades: { ...s.metaSnapshot.upgrades }, geneLevel: g.expedition.geneLevel,
        runSeed: s.runSeed, difficulty: s.difficulty, result: s.result ? { ...s.result } : null,
        drafts, deliveries, hits, birdWarnings, checkpoints, collectEvents,
      };
    });
    const afterHashes = hashes();
    const unchanged = protectedFiles.every(name => beforeHashes[name] === afterHashes[name]);
    console.log(JSON.stringify({ ...result, initialMeta, errors, protectedFilesUnchanged: unchanged, beforeHashes, afterHashes }, null, 2));
    if (!result.victory || !unchanged || errors.length || !result.realCollects.matchesStateCollected) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

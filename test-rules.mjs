import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Rogue as R } from './rogue.js';
import { Config } from './config.js';

let assertions = 0;
let groups = 0;
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, message);
  assertions++;
};
const ok = (value, message) => {
  assert.ok(value, message);
  assertions++;
};
const throws = (fn, message) => {
  assert.throws(fn, Error, message);
  assertions++;
};
const near = (actual, expected) => ok(Math.abs(actual - expected) < 1e-10, `${actual} 应接近 ${expected}`);
const clone = value => structuredClone(value);
const setup = (meta = R.freshMeta(), seed = 123, trait = 'forager', difficulty = 0) => {
  const s = {};
  R.initRun(s, meta, seed, trait, difficulty);
  return { s, meta };
};
const choose = (s, id) => eq(R.select(s, id, [id]), true);
const fillTarget = s => Object.assign(s, { mass: R.target(s).mass, aroma: R.target(s).aroma });
function test(name, fn) {
  fn();
  groups++;
  console.log(`通过 ${String(groups).padStart(2, '0')}：${name}`);
}

// 规则实现不应引用宿主 API；测试脚本自身的文件读取仅用于检查这一约束。
const source = await readFile(new URL('./rogue.js', import.meta.url), 'utf8');
test('ES module API 与纯规则边界', () => {
  for (const name of ['freshMeta', 'validateMeta', 'initRun', 'target', 'ready', 'stats', 'collect', 'draft', 'select', 'deliver', 'hit', 'tick', 'settle', 'buy']) {
    eq(typeof R[name], 'function');
  }
  ok(!/\b(?:document|window|localStorage|sessionStorage|fetch|Date)\b|Math\.random/.test(source));
  eq(R.UPGRADES.map(item => [item.id, item.max, item.cost]), ['shell', 'seed', 'legs', 'insurance'].map(id => [id, 3, [12, 24, 40]]));
  ok(R.PERKS.length >= 12);
  eq(new Set(R.PERKS.map(item => item.id)).size, R.PERKS.length);
  for (const perk of R.PERKS) {
    eq(perk.max, 2);
    ok(perk.name && perk.description && perk.tag);
  }
});

test('默认存档、规范化与引用隔离', () => {
  const meta = R.freshMeta();
  eq(meta, { version: 2, food: 18, genes: 0, offspring: 0, wins: 0, runs: 0, best: 0, upgrades: { shell: 0, seed: 0, legs: 0, insurance: 0 }, trait: 'forager', difficulty: 0, activeRun: null, stats: { collected: 0, banked: 0, bestWinSeconds: null }, claimed: [] });
  const normalized = R.validateMeta(meta);
  eq(normalized, meta);
  ok(normalized !== meta && normalized.upgrades !== meta.upgrades);
  ok(normalized.stats !== meta.stats && normalized.claimed !== meta.claimed);
  normalized.upgrades.shell = 3;
  normalized.stats.collected = 1;
  normalized.claimed.push('first_win');
  eq(meta.upgrades.shell, 0);
  eq(meta.stats, { collected: 0, banked: 0, bestWinSeconds: null });
  eq(meta.claimed, []);
  const legacy = clone(meta);
  delete legacy.stats;
  delete legacy.claimed;
  const beforeLegacy = clone(legacy);
  eq(R.validateMeta(legacy), meta);
  eq(legacy, beforeLegacy);
  const legacyState = setup(legacy).s;
  eq(legacyState.trait, 'forager');
  eq(legacy, beforeLegacy);
  meta.activeRun = { banked: 23, startedSeed: 0xffffffff, mode: 'playing', other: { arbitrary: true } };
  eq(R.validateMeta(meta).activeRun, { banked: 23, startedSeed: 0xffffffff });
  eq(meta.activeRun.mode, 'playing');
  eq(R.validateMeta(JSON.parse(JSON.stringify(meta))).activeRun.banked, 23);
  eq(R.freshMeta().upgrades.shell, 0);
});

test('拒绝坏存档、缺字段、类型强转、越界与原型字段', () => {
  for (const value of [null, undefined, '', 'null', [], 0, true, {}, new Date(), Object.create(R.freshMeta())]) {
    throws(() => R.validateMeta(value));
  }
  for (const key of Object.keys(R.freshMeta())) {
    const meta = R.freshMeta();
    delete meta[key];
    if (['stats', 'claimed'].includes(key)) {
      eq(R.validateMeta(meta), R.freshMeta(), `旧版存档允许缺少 ${key}`);
      eq(Object.hasOwn(meta, key), false);
    } else {
      throws(() => R.validateMeta(meta));
    }
  }
  for (const key of ['food', 'genes', 'offspring', 'wins', 'runs', 'best', 'difficulty']) {
    for (const value of [-1, 0.5, NaN, Infinity, '2', null, false, Number.MAX_SAFE_INTEGER]) {
      const meta = R.freshMeta();
      meta[key] = value;
      throws(() => R.validateMeta(meta), `${key} 不应接受 ${value}`);
    }
  }
  for (const value of [1, '2', 3, null]) {
    throws(() => R.validateMeta({ ...R.freshMeta(), version: value }));
  }
  for (const key of ['shell', 'seed', 'legs', 'insurance']) {
    for (const value of [-1, 21, 1.5, '1', NaN, Infinity, null, false, Number.MAX_SAFE_INTEGER]) {
      const meta = R.freshMeta();
      meta.upgrades[key] = value;
      throws(() => R.validateMeta(meta));
    }
    const missing = R.freshMeta();
    delete missing.upgrades[key];
    throws(() => R.validateMeta(missing));
  }
  for (const value of [null, [], 'shell', { shell: 0, seed: 0, legs: 0, insurance: 0, injected: 1 }]) {
    throws(() => R.validateMeta({ ...R.freshMeta(), upgrades: value }));
  }
  throws(() => R.validateMeta({ ...R.freshMeta(), cheat: 1 }));
  const polluted = JSON.parse(JSON.stringify(R.freshMeta()).replace('"version":2', '"__proto__":{"polluted":true},"version":2'));
  throws(() => R.validateMeta(polluted));
  eq({}.polluted, undefined);
  const symbolMeta = R.freshMeta();
  symbolMeta[Symbol('隐蔽字段')] = 1;
  throws(() => R.validateMeta(symbolMeta));
  const getterMeta = R.freshMeta();
  let getterCalls = 0;
  Object.defineProperty(getterMeta, 'food', { get() { getterCalls++; return 18; } });
  throws(() => R.validateMeta(getterMeta));
  eq(getterCalls, 0);
  for (const activeRun of [[], 3, 'run', {}, { banked: -1, startedSeed: 1 }, { banked: 0, startedSeed: 2 ** 32 }, { banked: 0, startedSeed: '1' }, { banked: 0.5, startedSeed: 0 }]) {
    throws(() => R.validateMeta({ ...R.freshMeta(), activeRun }));
  }
  const maximum = R.freshMeta();
  Object.assign(maximum, { food: 1e12, best: 1e12, genes: 1e9, offspring: 1e9, runs: 1e9, wins: 1e9, difficulty: 10 });
  eq(R.validateMeta(maximum), maximum);
});

test('统计与成就字段拒绝非法值、缺项及访问器', () => {
  for (const stats of [undefined, null, [], 'stats', 0, {}, Object.create(R.freshMeta().stats), { ...R.freshMeta().stats, injected: 1 }]) {
    throws(() => R.validateMeta({ ...R.freshMeta(), stats }));
  }
  for (const key of ['collected', 'banked', 'bestWinSeconds']) {
    const missing = R.freshMeta();
    delete missing.stats[key];
    throws(() => R.validateMeta(missing));
    const maximum = key === 'banked' ? 1e12 : 1e9;
    const invalid = [-1, NaN, Infinity, '2', false, undefined, maximum + 1];
    if (key !== 'bestWinSeconds') invalid.push(null, 0.5);
    for (const value of invalid) {
      const meta = R.freshMeta();
      meta.wins = 1;
      meta.stats[key] = value;
      throws(() => R.validateMeta(meta), `stats.${key} 不应接受 ${value}`);
    }
    const getterMeta = R.freshMeta();
    let getterCalls = 0;
    Object.defineProperty(getterMeta.stats, key, { get() { getterCalls++; return 0; } });
    throws(() => R.validateMeta(getterMeta));
    eq(getterCalls, 0);
  }
  const noWin = R.freshMeta();
  noWin.stats.bestWinSeconds = 0;
  throws(() => R.validateMeta(noWin));
  const valid = R.freshMeta();
  valid.wins = 1;
  valid.stats = { collected: 1e9, banked: 1e12, bestWinSeconds: null };
  valid.claimed = ['first_win', 'family', 'veteran', 'collector', 'banker', 'swift'];
  for (const seconds of [null, 0, 0.5, 1e9]) {
    valid.stats.bestWinSeconds = seconds;
    eq(R.validateMeta(valid), valid);
  }
  for (const claimed of [undefined, null, {}, 'first_win', 0, [null], [1], ['unknown'], ['__proto__'], ['constructor'], ['first_win', 'first_win'], Array(1), Array(7).fill('first_win')]) {
    throws(() => R.validateMeta({ ...R.freshMeta(), claimed }));
  }
  for (const key of ['stats', 'claimed']) {
    for (const extra of ['injected', '__proto__', Symbol('隐蔽字段')]) {
      const meta = R.freshMeta();
      Object.defineProperty(meta[key], extra, { value: 1, enumerable: true });
      throws(() => R.validateMeta(meta));
    }
    const getterMeta = R.freshMeta();
    let getterCalls = 0;
    Object.defineProperty(getterMeta, key, { get() { getterCalls++; return R.freshMeta()[key]; } });
    throws(() => R.validateMeta(getterMeta));
    eq(getterCalls, 0);
  }
  const getterClaimed = R.freshMeta();
  let getterCalls = 0;
  Object.defineProperty(getterClaimed.claimed, '0', { get() { getterCalls++; return 'first_win'; } });
  throws(() => R.validateMeta(getterClaimed));
  eq(getterCalls, 0);
});

test('存档升级允许 0 至 20，实际效果和购买受可配上限约束', () => {
  const original = Config.export();
  try {
    for (const cap of [3, 4, 20]) {
      const config = clone(original);
      for (const id of ['shell', 'seed', 'legs', 'insurance']) config.values[`upgrade.${id}.max`] = cap;
      Config.apply(config);
      for (const upgrade of R.UPGRADES) {
        eq(upgrade.max, cap);
        for (let level = 0; level <= 20; level++) {
          const meta = R.freshMeta();
          meta.upgrades[upgrade.id] = level;
          eq(R.validateMeta(meta), meta);
          const capped = clone(meta);
          capped.upgrades[upgrade.id] = Math.min(level, cap);
          const actual = setup(meta).s;
          const expected = setup(capped).s;
          eq(actual.metaSnapshot.upgrades[upgrade.id], level);
          eq([actual.startMass, actual.hp, R.stats(actual)], [expected.startMass, expected.hp, R.stats(expected)]);
          fillTarget(actual);
          R.deliver(actual, meta);
          eq(actual.mass, expected.startMass);
          meta.food = 1e12;
          const before = clone(meta);
          eq(R.buy(meta, upgrade.id), level < cap);
          if (level < cap) {
            eq([meta.upgrades[upgrade.id], meta.food], [level + 1, before.food - upgrade.cost[level]]);
          } else {
            eq(meta, before);
          }
        }
        const invalid = R.freshMeta();
        invalid.upgrades[upgrade.id] = 21;
        invalid.food = 1e12;
        const before = clone(invalid);
        throws(() => R.validateMeta(invalid));
        throws(() => setup(invalid));
        eq(R.buy(invalid, upgrade.id), false);
        eq(invalid, before);
      }
    }
  } finally {
    Config.apply(original);
  }
  eq(Config.export(), original);
});

test('初始化保留主层字段、清理旧局并隔离升级快照', () => {
  const meta = R.freshMeta();
  meta.upgrades = { shell: 2, seed: 3, legs: 2, insurance: 1 };
  const beforeMeta = clone(meta);
  const s = { mode: 'playing', sound: false, quality: true, x: 7, z: 9, custom: { retained: true }, result: { old: true }, completed: true };
  const custom = s.custom;
  eq(R.initRun(s, meta, 0), s);
  eq([s.mode, s.sound, s.quality, s.x, s.z, s.custom], ['playing', false, true, 7, 9, custom]);
  ok(s.custom === custom);
  for (const key of ['score', 'stage', 'stageDelivered', 'delivered', 'aroma', 'pocket', 'banked', 'genesEarned', 'elapsed', 'hitCount', 'risk', 'drafts', 'stageDrafts', 'collected', 'combo', 'invincible']) eq(s[key], 0);
  eq([s.time, s.mass, s.startMass, s.stamina, s.hp, s.maxHp, s.rng, s.rerolls], [210, 2.5, 2.5, 100, 6, 6, 0, 1]);
  eq([s.settled, s.completed, s.result, s.perks, s.trait, s.difficulty], [false, false, null, {}, 'forager', 0]);
  eq(meta, beforeMeta);
  ok(s.metaSnapshot.upgrades !== meta.upgrades);
  meta.upgrades.shell = 3;
  meta.upgrades.legs = 3;
  eq(R.stats(s).maxHp, 6);
  near(R.stats(s).speed, 1.1);
  for (const invalid of [-1, 1.5, '1', NaN, Infinity, 2 ** 32]) throws(() => setup(R.freshMeta(), invalid));
  const empty = setup().s;
  eq(Object.hasOwn(empty, 'quality'), false);
});

test('特质解锁权限与难度权限不可越权', () => {
  eq(R.TRAITS.map(item => [item.id, item.requireOffspring]), [['forager', 0], ['runner', 2], ['guardian', 4]]);
  for (const trait of ['runner', 'guardian']) {
    const meta = { ...R.freshMeta(), trait };
    const before = clone(meta);
    eq(R.validateMeta(meta), meta);
    const s = { quality: false, mode: 'home' };
    eq(R.initRun(s, meta, 1, trait), s);
    eq(s.trait, 'forager');
    eq([s.quality, s.mode], [false, 'home']);
    eq([s.hp, R.stats(s)], [setup().s.hp, R.stats(setup().s)]);
    eq(meta, before);
  }
  for (const trait of ['unknown', '__proto__', 'constructor', '', null, 1, {}]) {
    const s = { quality: false, mode: 'home' };
    throws(() => R.initRun(s, R.freshMeta(), 1, trait));
    eq(s, { quality: false, mode: 'home' });
    throws(() => R.validateMeta({ ...R.freshMeta(), trait }));
  }
  const meta = R.freshMeta();
  meta.offspring = 2;
  const runner = setup(meta, 1, 'runner').s;
  eq(runner.hp, 3);
  near(R.stats(runner).speed, 1.12);
  eq(R.stats(runner).growth, 1);
  const lockedGuardian = setup(meta, 1, 'guardian').s;
  eq(lockedGuardian.trait, 'forager');
  eq([lockedGuardian.hp, R.stats(lockedGuardian)], [setup(meta).s.hp, R.stats(setup(meta).s)]);
  meta.offspring = 4;
  meta.trait = 'guardian';
  eq(R.validateMeta(meta).trait, 'guardian');
  const guardian = setup(meta, 1, 'guardian').s;
  eq(guardian.hp, 6);
  near(R.stats(guardian).speed, 0.92);
  meta.upgrades.legs = 3;
  near(R.stats(setup(meta, 1, 'runner').s).speed, 1.12 * 1.15);
  throws(() => setup(meta, 1, 'forager', 1));
  meta.difficulty = 3;
  eq(setup(meta, 1, 'forager', 3).s.difficulty, 3);
  for (const difficulty of [-1, 4, 11, '1', 1.1]) throws(() => setup(meta, 1, 'forager', difficulty));
});

test('三阶段门槛、目标文案与画质字段独立', () => {
  const { s } = setup();
  for (const [stage, mass, aroma, count, name] of [[0, 6, 0, 2, '储粮过冬'], [1, 10, 3, 1, '芳香求偶'], [2, 8, 1, 2, '育婴新生']]) {
    s.stage = stage;
    const goal = R.target(s);
    eq([goal.mass, goal.aroma, goal.count, goal.name], [mass, aroma, count, name]);
    ok(typeof goal.description === 'string' && goal.description.length > 0);
    s.mass = mass - 0.01;
    s.aroma = aroma + 10;
    eq(R.ready(s), false);
    s.mass = mass;
    s.aroma = aroma;
    eq(R.ready(s), true);
    if (aroma) {
      s.aroma--;
      eq(R.ready(s), false);
    }
  }
  for (const quality of [true, false]) {
    const { s, meta } = setup();
    s.quality = quality;
    R.collect(s, 0, true);
    eq(s.aroma, 1);
    eq(s.quality, quality);
    s.stage = 1;
    s.mass = 10;
    eq(R.ready(s), false);
    R.collect(s, 0, true);
    R.collect(s, 0, true);
    eq(R.ready(s), true);
    R.deliver(s, meta);
    eq(s.aroma, 0);
    eq(s.quality, quality);
  }
});

test('普通采集、金色采集、质量封顶与每12次升级', () => {
  const { s } = setup();
  const collected = R.collect(s, 2, false);
  near(collected.massGain, 2.24);
  eq([collected.aromaGain, collected.levelUp, s.collected, s.combo, s.score, s.pocket], [0, false, 1, 1, 20, 1]);
  for (let i = 2; i <= 24; i++) {
    const beforeScore = s.score;
    const result = R.collect(s, 1, false);
    eq(result.levelUp, i % 12 === 0);
    eq(s.score - beforeScore, 20 * Math.min(5, Math.ceil(i / 3)));
  }
  eq(s.mass, 24);
  eq(R.collect(s, 20, false).massGain, 0);
  const before = clone(s);
  s.stamina = 3;
  eq(R.collect(s, undefined, true), { massGain: 0, aromaGain: 1, levelUp: false });
  eq([s.mass, s.collected, s.combo, s.score], [before.mass, before.collected, before.combo, before.score]);
  eq([s.stamina, s.pocket, s.aroma], [100, before.pocket + 3, 1]);
  for (const value of [-1, NaN, Infinity, '1', undefined]) {
    const before = clone(s);
    throws(() => R.collect(s, value, false));
    eq(s, before);
  }
});

test('种子随机可复现、固定序列、候选唯一与耗尽兜底', () => {
  const a = setup(R.freshMeta(), 0).s;
  eq(R.draft(a), ['magnet', 'recovery', 'bank']);
  eq(a.rng, 3519870697);
  eq([a.drafts, a.stageDrafts], [1, 1]);
  const b = setup(R.freshMeta(), 12345).s;
  const c = setup(R.freshMeta(), 12345).s;
  for (let i = 0; i < 20; i++) {
    const offered = R.draft(b);
    eq(offered, R.draft(c));
    eq(new Set(offered).size, 3);
    eq(b.rng, c.rng);
    choose(b, offered[0]);
    choose(c, offered[0]);
  }
  const alternate = setup(R.freshMeta(), 98765).s;
  ok(JSON.stringify(R.draft(alternate)) !== JSON.stringify(R.draft(setup(R.freshMeta(), 12345).s)));
  const permanent = R.PERKS.filter(perk => perk.tag !== '即时');
  for (const remaining of [0, 1, 2]) {
    const s = setup().s;
    for (const perk of permanent) s.perks[perk.id] = perk.max;
    for (const perk of permanent.slice(0, remaining)) s.perks[perk.id] = 1;
    const offered = R.draft(s);
    eq(offered.length, 3);
    eq(new Set(offered).size, 3);
    eq(offered.filter(id => ['heal', 'clock', 'cash'].includes(id)).length, 3 - remaining);
    for (const id of offered) ok(['heal', 'clock', 'cash'].includes(id) || s.perks[id] < 2);
  }
});

test('非法选卡拒绝、等级上限及每张常驻卡两级生效', () => {
  const s = setup().s;
  for (const [id, offered] of [['swift', ['growth']], ['unknown', ['unknown']], ['__proto__', ['__proto__']], ['constructor', ['constructor']], ['heal', null], ['swift', 'swift']]) {
    const before = clone(s);
    eq(R.select(s, id, offered), false);
    eq(s, before);
  }
  const expected = {
    swift: (a, level) => near(a.speed, 1 + 0.1 * level),
    growth: (a, level) => near(a.growth, 1.12 * (1 + 0.2 * level)),
    magnet: (a, level) => eq(a.magnet, 0.55 * level),
    endurance: (a, level) => near(a.drain, 1 - 0.15 * level),
    recovery: (a, level) => near(a.regen, 1 + 0.25 * level),
    armor: (a, level) => near(a.armor, 0.3 * level),
    insurance: (a, level) => near(a.insurance, 0.2 + 0.1 * level),
    aroma: (a, level) => eq(a.aromaBonus, level),
    jump: (a, level) => eq(a.jump, 1.5 * level),
    thorns: (a, level) => { eq(a.thorns, true); near(a.armor, 0.05 * level); },
    bank: (a, level) => eq(a.bankBonus, 1 + 0.25 * level),
    vitality: (a, level) => eq(a.maxHp, 4 + level),
  };
  eq(Object.keys(expected).sort(), R.PERKS.filter(perk => perk.tag !== '即时').map(perk => perk.id).sort());
  for (const [id, check] of Object.entries(expected)) {
    const { s } = setup();
    const base = R.stats(s);
    for (const level of [1, 2]) {
      choose(s, id);
      check(R.stats(s), level);
      ok(JSON.stringify(base) !== JSON.stringify(R.stats(s)));
      eq(s.perks[id], level);
    }
    eq(R.select(s, id, [id]), false);
    ok(!R.draft(s).includes(id));
  }
  const base = R.stats(setup().s);
  eq(Object.keys(base).sort(), ['speed', 'growth', 'magnet', 'drain', 'regen', 'armor', 'insurance', 'aromaBonus', 'jump', 'thorns', 'bankBonus', 'maxHp'].sort());
  eq([base.speed, base.magnet, base.drain, base.regen, base.armor, base.insurance, base.aromaBonus, base.jump, base.thorns, base.bankBonus, base.maxHp], [1, 0, 1, 1, 0, 0.2, 0, 0, false, 1, 4]);
});

test('卡牌真实行为、即时卡重复生效与上下限', () => {
  const { s } = setup();
  choose(s, 'growth');
  near(R.collect(s, 2, false).massGain, 2 * 1.12 * 1.2);
  choose(s, 'aroma');
  choose(s, 'aroma');
  eq(R.collect(s, 0, true).aromaGain, 3);
  s.hp = 1;
  choose(s, 'vitality');
  eq([s.hp, s.maxHp], [2, 5]);
  choose(s, 'vitality');
  eq([s.hp, s.maxHp], [3, 6]);
  for (let i = 0; i < 4; i++) choose(s, 'heal');
  eq(s.hp, 6);
  s.time = 295;
  choose(s, 'clock');
  eq(s.time, 300);
  for (let i = 0; i < 4; i++) choose(s, 'cash');
  eq(s.pocket, 36);
  eq([s.perks.heal, s.perks.clock, s.perks.cash], [undefined, undefined, undefined]);
  choose(s, 'armor');
  choose(s, 'armor');
  choose(s, 'thorns');
  choose(s, 'thorns');
  near(R.stats(s).armor, 0.7);
  s.mass = 20;
  near(R.hit(s).loss, 1.5);
  s.invincible = 0;
  s.mass = 10;
  s.pocket = 7;
  choose(s, 'bank');
  choose(s, 'bank');
  const meta = R.freshMeta();
  eq(R.deliver(s, meta).banked, 37);
  eq(meta.food, 55);
});

test('五次交付完成三阶段、时间封顶与终点防重复交付', () => {
  const { s, meta } = setup();
  meta.upgrades.seed = 2;
  R.initRun(s, meta, 3);
  const before = clone({ s, meta });
  eq(R.deliver(s, meta), { ok: false, stageChange: false, won: false, banked: 0 });
  eq({ s, meta }, before);
  const stages = [0, 1, 2, 2, 2];
  const stageCounts = [1, 0, 0, 1, 0];
  const banks = [15, 15, 23, 19, 19];
  for (let index = 0; index < 5; index++) {
    fillTarget(s);
    s.pocket = 3;
    s.hp = 1;
    s.stamina = 5;
    s.stageDrafts = 2;
    s.time = 290;
    const result = R.deliver(s, meta);
    eq(result, { ok: true, stageChange: index === 1 || index === 2, won: index === 4, banked: banks[index] });
    eq([s.stage, s.stageDelivered, s.delivered], [stages[index], stageCounts[index], index + 1]);
    eq([s.mass, s.aroma, s.pocket, s.stamina, s.hp, s.invincible], [2, 0, 0, 100, 2, 3]);
    eq(s.time, [1, 2, 4].includes(index) ? 300 : 290);
    eq(s.stageDrafts, [1, 2, 4].includes(index) ? 0 : 2);
    eq(s.settled, false);
  }
  eq([s.score, s.banked, meta.food], [3800, 91, 109]);
  eq(R.target(s).name, '育婴新生');
  fillTarget(s);
  const finalState = clone({ s, meta });
  eq(R.deliver(s, meta).ok, false);
  eq({ s, meta }, finalState);
  const win = R.settle(s, meta, 'win');
  eq(win.banked, 91);
  eq(meta.food, 149);
});

test('受击减血、质量地板、减甲、无敌与死亡', () => {
  const { s } = setup();
  Object.assign(s, { mass: 20, aroma: 3, time: 100, combo: 5, pocket: 9, banked: 30 });
  eq(R.hit(s), { hit: true, dead: false, loss: 5 });
  eq([s.hp, s.mass, s.aroma, s.time, s.combo, s.hitCount, s.invincible, s.pocket, s.banked], [3, 15, 2, 96, 0, 1, 2.2, 9, 30]);
  const before = clone(s);
  eq(R.hit(s), { hit: false, dead: false, loss: 0 });
  eq(s, before);
  R.tick(s, 2.2);
  s.mass = 3;
  near(R.hit(s).loss, 1.8);
  s.invincible = 0;
  s.hp = 1;
  s.mass = 1.2;
  s.time = 2;
  s.aroma = 0;
  const death = R.hit(s);
  eq([death.hit, death.dead], [true, true]);
  near(death.loss, 0.2);
  eq([s.hp, s.mass, s.time, s.aroma], [0, 1, 0, 0]);
  s.invincible = 0;
  eq(R.hit(s).loss, 0);
});

test('tick 只推进基础时间、不处理体力或渲染状态', () => {
  const { s } = setup();
  Object.assign(s, { time: 1, invincible: 2.2, stamina: 10, hp: 3, mode: 'playing', quality: false });
  const before = clone(s);
  R.tick(s, 0.5);
  eq(s, { ...before, time: 0.5, elapsed: 0.5, invincible: before.invincible - 0.5 });
  near(s.invincible, 1.7);
  R.tick(s, 5);
  eq([s.time, s.elapsed, s.invincible, s.stamina], [0, 5.5, 0, 10]);
  const after = clone(s);
  R.tick(s, 0);
  eq(s, after);
  for (const dt of [-1, NaN, Infinity, '1']) {
    throws(() => R.tick(s, dt));
    eq(s, after);
  }
});

test('银行永久安全、失败背包损失与保险浮点边界', () => {
  const { s, meta } = setup();
  s.mass = 6;
  s.pocket = 10;
  eq(R.deliver(s, meta).banked, 22);
  eq(meta.food, 40);
  s.pocket = 13;
  s.time = 0;
  const result = R.settle(s, meta, 'fail');
  eq(result, { outcome: 'fail', recovered: 2, lost: 11, banked: 22, genes: 0, offspring: 0, score: 600, reasonLabel: '时间耗尽' });
  eq([meta.food, meta.runs, meta.wins, meta.best, s.pocket], [42, 1, 0, 600, 0]);
  for (const [tier, expected] of [[0, 20], [1, 35], [2, 50], [3, 65]]) {
    const meta = R.freshMeta();
    meta.upgrades.insurance = tier;
    const { s } = setup(meta);
    s.pocket = 100;
    const result = R.settle(s, meta, 'fail');
    eq([result.recovered, result.lost], [expected, 100 - expected]);
  }
  const insured = R.freshMeta();
  insured.upgrades.insurance = 3;
  const insuredState = setup(insured).s;
  choose(insuredState, 'insurance');
  choose(insuredState, 'insurance');
  insuredState.pocket = 100;
  eq(R.settle(insuredState, insured, 'fail').recovered, 85);
});

test('撤退回收、胜利奖励、剩时加分与首次结果幂等', () => {
  const insuredRetreat = setup();
  insuredRetreat.s.metaSnapshot.upgrades.insurance = 3;
  insuredRetreat.s.perks.insurance = 2;
  insuredRetreat.s.pocket = 100;
  eq(R.settle(insuredRetreat.s, insuredRetreat.meta, 'retreat').recovered, 85);
  const retreat = setup();
  retreat.s.pocket = 13;
  retreat.s.score = 200;
  retreat.meta.best = 500;
  const retreated = R.settle(retreat.s, retreat.meta, 'retreat');
  eq([retreated.recovered, retreated.lost, retreated.score, retreated.reasonLabel], [7, 6, 200, '主动撤退']);
  eq([retreat.meta.food, retreat.meta.best], [25, 500]);
  const meta = R.freshMeta();
  meta.difficulty = 3;
  meta.activeRun = { banked: 0, startedSeed: 55 };
  const { s } = setup(meta, 55, 'forager', 3);
  Object.assign(s, { pocket: 13, score: 200, time: 10.5, banked: 22 });
  const result = R.settle(s, meta, 'win');
  eq(result, { outcome: 'win', recovered: 83, lost: 0, banked: 22, genes: 6, offspring: 2, score: 284, reasonLabel: '育婴成功' });
  eq([meta.food, meta.genes, meta.offspring, meta.wins, meta.runs, meta.best, meta.activeRun, s.genesEarned, s.settled], [101, 6, 2, 1, 1, 284, null, 6, true]);
  const before = clone({ s, meta });
  for (const outcome of ['win', 'fail', 'retreat']) {
    ok(R.settle(s, meta, outcome) === result);
    eq({ s, meta }, before);
  }
  const invalid = setup();
  const untouched = clone(invalid);
  throws(() => R.settle(invalid.s, invalid.meta, 'unknown'));
  eq(invalid, untouched);
  invalid.s.hp = 0;
  eq(R.settle(invalid.s, invalid.meta, 'fail').reasonLabel, '生命耗尽');
  eq(R.validateMeta(meta), meta);
});

test('结算后的所有局内写操作均无效，重新开局可恢复', () => {
  const { s, meta } = setup();
  R.settle(s, meta, 'retreat');
  const before = clone({ s, meta });
  eq(R.collect(s, 2, false), { massGain: 0, aromaGain: 0, levelUp: false });
  eq(R.collect(s, 0, true), { massGain: 0, aromaGain: 0, levelUp: false });
  eq(R.draft(s), []);
  eq(R.select(s, 'cash', ['cash']), false);
  eq(R.deliver(s, meta).ok, false);
  eq(R.hit(s), { hit: false, dead: false, loss: 0 });
  R.tick(s, 9);
  eq({ s, meta }, before);
  R.initRun(s, meta, 1);
  eq([s.settled, s.result, s.completed, s.time], [false, null, false, 210]);
  ok(R.collect(s, 1, false).massGain > 0);
});

test('四类永久升级价格、余额校验与三级上限', () => {
  for (const upgrade of R.UPGRADES) {
    const meta = R.freshMeta();
    meta.food = 100;
    for (const [level, cost, remaining] of [[1, 12, 88], [2, 24, 64], [3, 40, 24]]) {
      eq(upgrade.cost[level - 1], cost);
      eq(R.buy(meta, upgrade.id), true);
      eq([meta.food, meta.upgrades[upgrade.id]], [remaining, level]);
    }
    const before = clone(meta);
    eq(R.buy(meta, upgrade.id), false);
    eq(meta, before);
    const exact = R.freshMeta();
    exact.food = 12;
    eq(R.buy(exact, upgrade.id), true);
    eq(exact.food, 0);
    const insufficient = R.freshMeta();
    insufficient.food = 11;
    const unchanged = clone(insufficient);
    eq(R.buy(insufficient, upgrade.id), false);
    eq(insufficient, unchanged);
  }
  const meta = R.freshMeta();
  for (const id of ['unknown', '__proto__', 'constructor', '', null]) {
    const before = clone(meta);
    eq(R.buy(meta, id), false);
    eq(meta, before);
  }
  const { s } = setup(meta);
  eq(R.buy(meta, 'shell'), true);
  eq(R.stats(s).maxHp, 4);
  eq(setup(meta).s.maxHp, 5);
});

console.log(`\n规则测试通过：${groups} 组，${assertions} 条断言，0 失败。`);

import { Config } from './config.js';

const $ = id => document.getElementById(id);
const fields = Config.fields;
const byKey = new Map(fields.map(field => [field.key, field]));
const STORAGE_KEY = 'dung-tuning-draft-v1';
const MAX_FILE_SIZE = 200 * 1024;
const upgradeNames = [['shell', '厚实甲壳'], ['seed', '育球种子'], ['legs', '强健足肢'], ['insurance', '应急储备']];
const traitNames = [['forager', '采集者'], ['runner', '奔跑者'], ['guardian', '守护者']];
const perkNames = [['swift', '疾行'], ['growth', '沃土'], ['magnet', '吸附'], ['endurance', '耐力'], ['recovery', '回春'], ['armor', '护球'], ['insurance', '藏粮'], ['aroma', '花香'], ['jump', '弹跳'], ['thorns', '荆棘'], ['bank', '丰收'], ['vitality', '生机']];
const achievementNames = [['first_win', '初次育婴'], ['family', '繁衍家族'], ['veteran', '远征老手'], ['collector', '采集达人'], ['banker', '储粮专家'], ['swift', '速战速决']];
let draft = Object.fromEntries(fields.map(field => [field.key, String(field.default)]));
let applied = Config.validate(Config.export());
let appliedLabel = '本页初始规则快照';
let selectedGroup = '全部';
let mutation = 0;
let fileRequest = 0;
let storageBlocked = false;
const rowViews = new Map();
const groupButtons = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function message(text, tone = 'info') {
  $('status').textContent = text;
  $('status').dataset.tone = tone;
}
function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '不可达';
}
function quotient(need, income) {
  return need <= 0 ? 0 : income > 0 ? Math.ceil(need / income) : Infinity;
}
function revision(values) {
  let result = 2166136261;
  for (const char of JSON.stringify(values)) result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
  return result.toString(16).padStart(8, '0');
}
function parseField(field, raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: '不能为空，请填写数字' };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) return { error: '请输入完整十进制数字' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: '必须是有限数字' };
  if (field.integer && !Number.isSafeInteger(value)) return { error: '必须是安全整数' };
  if (value < field.min || value > field.max) return { error: `范围 ${field.min} 至 ${field.max}` };
  return { value: Object.is(value, -0) ? 0 : value };
}
function inspectDraft() {
  const values = {};
  const errors = new Map();
  for (const field of fields) {
    const parsed = parseField(field, draft[field.key]);
    if (parsed.error) errors.set(field.key, parsed.error);
    else values[field.key] = parsed.value;
  }
  if (errors.size) return { ok: false, errors, error: `${errors.size} 项非法输入；首项 ${errors.keys().next().value}：${errors.values().next().value}` };
  try {
    return { ok: true, errors, envelope: Config.validate({ format: 'dung-balance-1', version: 1, values }) };
  } catch (cause) {
    return { ok: false, errors, error: `跨字段校验：${cause.message}` };
  }
}
function isChanged(field) {
  const parsed = parseField(field, draft[field.key]);
  return Boolean(parsed.error) || parsed.value !== field.default;
}
function saveDraft() {
  if (storageBlocked) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, raw: draft }));
    $('storageStatus').textContent = '草稿已自动保存（含未完成输入）· dung-tuning-draft-v1 · 仅当前浏览器/路径可用；未写入游戏配置。';
    $('storageStatus').dataset.tone = 'success';
  } catch (cause) {
    $('storageStatus').textContent = `自动保存失败：${cause.message}。草稿仍在本页内存中；修正并下载 JSON 后再离开，刷新可能丢失。`;
    $('storageStatus').dataset.tone = 'error';
  }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      $('storageStatus').textContent = '尚无本页草稿。编辑后自动保存到 dung-tuning-draft-v1；不读取或写入游戏配置。';
      return;
    }
    if (new Blob([raw]).size > MAX_FILE_SIZE) throw new Error('草稿缓存超过 200KB');
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length !== 2 || saved.version !== 1 || !Object.hasOwn(saved, 'raw')) throw new Error('草稿缓存结构不合法');
    const values = saved.raw;
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== fields.length || Object.keys(values).some(key => !byKey.has(key))) throw new Error('草稿缓存含未知或缺失字段');
    if (fields.some(field => typeof values[field.key] !== 'string')) throw new Error('草稿缓存的原始值必须为字符串');
    draft = Object.fromEntries(fields.map(field => [field.key, values[field.key]]));
    $('storageStatus').textContent = '已恢复独立草稿（包括原有非法输入）；需重新校验，未应用到游戏。';
  } catch (cause) {
    storageBlocked = true;
    $('storageStatus').textContent = `草稿读取失败：${cause.message}。已保留原缓存且暂停覆盖；本页改动仅存于内存，请下载 JSON 备份。`;
    $('storageStatus').dataset.tone = 'error';
  }
}
function buildRows() {
  const fragment = document.createDocumentFragment();
  for (const [index, field] of fields.entries()) {
    const row = element('tr');
    row.dataset.key = field.key;
    const key = element('td', 'key-cell');
    key.append(element('code', '', field.key));
    row.append(key, element('td', 'field-label', field.label));
    const editor = element('td');
    const input = element('input', 'field-editor');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.key = field.key;
    input.id = `field-${index}`;
    input.setAttribute('aria-label', `${field.label}（${field.key}）`);
    const error = element('span', 'field-error');
    error.id = `error-${index}`;
    input.setAttribute('aria-describedby', error.id);
    input.addEventListener('input', () => setValue(field.key, input.value));
    editor.append(input, error);
    const help = element('td', 'help-cell', field.help);
    help.append(element('small', '', field.impact));
    if (field.key === 'estimate.foodPerRun') help.append(element('small', '', '口径：含成败、已结算的平均每局净收益；不得再次乘成功率。'));
    if (field.key === 'gene.aromaPerLevel') help.append(element('small', '', '基因仅首球；交付后香气归零。本页零基因估算不扣减任何香气需求。'));
    const action = element('td');
    const reset = element('button', 'row-reset', '恢复');
    reset.type = 'button';
    reset.setAttribute('aria-label', `恢复 ${field.label} 默认值`);
    reset.addEventListener('click', () => setValue(field.key, field.default));
    action.append(reset);
    row.append(editor, element('td', 'default-cell', field.default), element('td', '', field.unit || '—'), element('td', 'range-cell', `${field.min} – ${field.max}${field.integer ? ' · 整数' : ''}`), help, action);
    rowViews.set(field.key, { row, input, error, reset, search: `${field.key} ${field.group} ${field.label} ${field.help} ${field.impact}`.toLowerCase() });
    fragment.append(row);
  }
  $('configRows').append(fragment);
  const groups = ['全部', ...new Set(fields.map(field => field.group))];
  for (const group of groups) {
    const button = element('button');
    button.type = 'button';
    button.append(element('span', '', group === '估算' ? '估算 · 不入规则' : group), element('span', 'nav-count', group === '全部' ? fields.length : fields.filter(field => field.group === group).length));
    button.addEventListener('click', () => { selectedGroup = group; filterRows(); });
    groupButtons.set(group, button);
    $('groupNav').append(button);
  }
}
function filterRows() {
  const search = $('searchInput').value.trim().toLowerCase();
  const changedOnly = $('onlyChanged').checked;
  let visible = 0;
  for (const field of fields) {
    const view = rowViews.get(field.key);
    const show = (selectedGroup === '全部' || field.group === selectedGroup) && (!search || view.search.includes(search)) && (!changedOnly || isChanged(field));
    view.row.hidden = !show;
    if (show) visible++;
  }
  for (const [group, button] of groupButtons) button.setAttribute('aria-pressed', String(selectedGroup === group));
  $('visibleCount').textContent = `${visible} / ${fields.length} 项`;
  $('emptyState').hidden = visible > 0;
}
function setValue(key, value) {
  if (!byKey.has(key)) throw new Error(`未知字段：${key}`);
  if (!['string', 'number'].includes(typeof value)) throw new Error('编辑值必须是字符串或数字');
  draft[key] = String(value);
  mutation++;
  saveDraft();
  const result = refresh();
  message(result.ok ? '草稿已改动，尚未更新本页 applied 快照；请校验后下载，再到游戏导入。' : `草稿未通过校验：${result.error}。导出已禁用。`, result.ok ? 'info' : 'error');
  return result.ok;
}
function commitSnapshot(envelope, label) {
  applied = { format: envelope.format, version: envelope.version, values: { ...envelope.values } };
  appliedLabel = label;
}
function validateDraft() {
  const result = inspectDraft();
  if (!result.ok) {
    refresh();
    message(`校验失败：${result.error}。草稿保留；未更新 applied，也不会导出。`, 'error');
    return { ok: false, error: result.error };
  }
  commitSnapshot(result.envelope, '最近校验通过的本页快照');
  refresh();
  message('全部字段与关联约束校验通过。applied 仅是本页校验快照，不代表游戏已应用；下一步下载 JSON。', 'success');
  return { ok: true, envelope: result.envelope, revision: revision(result.envelope.values) };
}
function importConfig(envelope) {
  try {
    // 先完整验证，成功后才原子替换草稿；不调用 Config.load/apply。
    const checked = Config.validate(envelope);
    const next = Object.fromEntries(fields.map(field => [field.key, String(checked.values[field.key])]));
    draft = next;
    mutation++;
    commitSnapshot(checked, '最近导入并校验的本页快照');
    saveDraft();
    refresh();
    message('配置完整校验通过，已导入本页。尚未同步游戏：请下载 JSON，在游戏「我的巢穴」导入并对照 revision。', 'success');
    return { ok: true, revision: revision(checked.values) };
  } catch (cause) {
    message(`导入失败：${cause.message}。草稿、applied 与缓存均未改变；原文件未覆盖。`, 'error');
    return { ok: false, error: cause.message };
  }
}
async function readImport(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const request = ++fileRequest;
  const startMutation = mutation;
  try {
    if (file.size > MAX_FILE_SIZE) throw new Error('文件超过 200KB 上限');
    const text = await file.text();
    if (request !== fileRequest) return;
    if (file.size > MAX_FILE_SIZE || new Blob([text]).size > MAX_FILE_SIZE) throw new Error('读取后文件超过 200KB 上限');
    if (startMutation !== mutation) throw new Error('读取期间草稿已修改，请重新选择文件，避免覆盖新改动');
    importConfig(JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch (cause) {
    if (request === fileRequest) message(`导入失败：${cause.message}。草稿与 applied 未改变；文件未覆盖。`, 'error');
  } finally {
    if (request === fileRequest) input.value = '';
  }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
}
function exportConfig() {
  const result = inspectDraft();
  if (!result.ok) { message(`禁止导出：${result.error}`, 'error'); return false; }
  try {
    download(new Blob([JSON.stringify(result.envelope, null, 2)], { type: 'application/json;charset=utf-8' }), '生命远征-数值配置.json');
    commitSnapshot(result.envelope, '最近发起下载的本页快照');
    refresh();
    message('已发起「生命远征-数值配置.json」下载，请确认浏览器保存成功。再到游戏「我的巢穴」导入，对照 revision 后开新局。', 'success');
    return true;
  } catch (cause) { message(`下载失败：${cause.message}。草稿保留，请重试。`, 'error'); return false; }
}
function calculate(v) {
  const avgNormalMass = (v['world.normalMin'] + v['world.normalMax']) / 2;
  const growth = v['trait.forager.growth'];
  const stages = [0, 1, 2].map(index => {
    const count = v[`stage.${index}.count`];
    const ordinary = quotient(Math.max(0, v[`stage.${index}.mass`] - v['run.startMass']), avgNormalMass * growth);
    const gold = quotient(v[`stage.${index}.aroma`], v['collect.goldAroma']);
    return { index, count, ordinary, gold, ordinaryTotal: ordinary * count, goldTotal: gold * count };
  });
  const ordinary = stages.reduce((sum, stage) => sum + stage.ordinaryTotal, 0);
  const gold = stages.reduce((sum, stage) => sum + stage.goldTotal, 0);
  const deliveries = stages.reduce((sum, stage) => sum + stage.count, 0);
  const pickupSeconds = (ordinary + gold) / v['estimate.pickupsPerMinute'] * 60;
  const travelSeconds = deliveries * v['estimate.distancePerDelivery'] / v['estimate.travelSpeed'];
  const activeSeconds = pickupSeconds + travelSeconds;
  const budget = v['run.baseTime'] + 2 * v['run.stageBonus'];
  const upgrades = upgradeNames.map(([id, name]) => {
    const costs = Array.from({ length: v[`upgrade.${id}.max`] }, (_, index) => index < 3 ? v[`upgrade.${id}.cost${index + 1}`] : Math.ceil(v[`upgrade.${id}.cost3`] * v[`upgrade.${id}.costGrowth`] ** (index - 2)));
    return { id, name, costs, total: costs.reduce((sum, cost) => sum + cost, 0) };
  });
  const totalFood = upgrades.reduce((sum, upgrade) => sum + upgrade.total, 0);
  const netFood = Math.max(0, totalFood - v['meta.initialFood']);
  const geneCost = v['gene.max'] * v['gene.cost'];
  const genePerRun = v['estimate.successRate'] * v['settle.winGenes'];
  const offspringPerRun = v['estimate.successRate'] * v['settle.offspring'];
  return { avgNormalMass, growth, stages, ordinary, gold, deliveries, pickupSeconds, travelSeconds, activeSeconds, budget, upgrades, totalFood, netFood, foodRuns: quotient(netFood, v['estimate.foodPerRun']), geneCost, genePerRun, geneRuns: quotient(geneCost, genePerRun), offspringPerRun };
}
function card(title) {
  const node = element('article', 'experiment-card');
  node.append(element('h4', '', title));
  return node;
}
function miniTable(headers, rows) {
  const wrap = element('div', 'mini-scroll');
  const table = element('table', 'mini-table');
  const head = element('thead');
  const headRow = element('tr');
  headers.forEach(label => { const th = element('th', '', label); th.scope = 'col'; headRow.append(th); });
  head.append(headRow);
  const body = element('tbody');
  rows.forEach(values => { const row = element('tr'); values.forEach(value => row.append(element('td', '', value))); body.append(row); });
  table.append(head, body);
  wrap.append(table);
  return wrap;
}
function renderExperiments(v, c) {
  const grid = element('div', 'experiment-grid');
  const collection = card('01 / 每颗球，从零升级开始');
  collection.append(element('p', '', `avgNormalMass = (world.normalMin + world.normalMax) / 2 = ${fmt(c.avgNormalMass, 4)} kg；采集者 growth = ${fmt(c.growth)}；baseStart = ${fmt(v['run.startMass'])} kg。`), element('code', 'formula', 'ordinaryNeeded = ceil(max(0, mass − baseStart) / (avgNormalMass × forager.growth))\ngoldNeed = ceil(stage.aroma / goldAroma)\n总采集 = Σ stage.count × (ordinaryNeeded + goldNeed)\n总交付 = Σ stage.count'), miniTable(['阶段', '交付', '普通/颗', '金色/颗', '普通 + 金色合计'], c.stages.map(stage => [stage.index + 1, stage.count, fmt(stage.ordinary), fmt(stage.gold), `${fmt(stage.ordinaryTotal)} + ${fmt(stage.goldTotal)}`])), element('p', '', '每次交付后质量回到 baseStart、aroma 归 0；基因仅首球，这里零基因，因此每颗都要重新满足香气。金色采集不增加质量。普通质量均值未加外围加成，未纳入起始区质量、刷新等待与采集分布。'));
  const pace = card('02 / 实际粗估耗时，不是倒计时');
  pace.append(element('div', 'big-result', `${fmt(c.activeSeconds)} 秒`), element('code', 'formula', '实际粗估秒数 = (Σ普通 + Σ金色) / pickupsPerMinute × 60\n             + deliveries × distancePerDelivery / travelSpeed'), element('p', '', `采集项 ${fmt(c.pickupSeconds)} 秒 + 交付移动项 ${fmt(c.travelSeconds)} 秒。现实会话粗估 ${fmt(c.activeSeconds + v['estimate.sessionOverhead'])} 秒，含局外/暂停开销 ${fmt(v['estimate.sessionOverhead'])} 秒；该开销不计 active，也不消耗倒计时。`), element('p', '', '采集与行走可能重叠，直接相加会高估；敌袭、绕路、受击后的补采与等待刷新会使本式低估。无构筑零升级静态估算，非 Monte Carlo、非实测、非验证。'));
  const clock = card('03 / 时间预算的三条边界');
  clock.append(element('div', 'big-result', `${fmt(c.budget)} 秒名义预算`), element('code', 'formula', `完成前名义可用预算 = baseTime + 2 × stageBonus\n= ${v['run.baseTime']} + 2 × ${v['run.stageBonus']} = ${fmt(c.budget)} 秒\n续时后 time = min(timeCap, 当前 time + bonus)\n受击后 time = max(0, 当前 time − hit.time)`), element('p', '', `只有前两阶段完成续时参与完成前时间，最终交付的 bonus 不参与。阶段续时每次 +${fmt(v['run.stageBonus'])} 秒；即时卡 instant.clock 每次 +${fmt(v['instant.clock'])} 秒，均受 timeCap = ${fmt(v['run.timeCap'])} 秒的当下剩余时间限制。cap 不是总时长；触顶截断会使上述名义预算减少。`), element('p', '', `hit.time 每次受击惩罚 ${fmt(v['hit.time'])} 秒；遗物交易扣除 ${fmt(v['relic.time'])} 秒。两者和随机即时卡均未计入名义预算。`), element('p', '', v['run.hardLimit'] === 0 ? 'hardLimit = 0：累计 active 硬上限关闭，不表示倒计时不会耗尽。' : `累计 active 硬上限 ${fmt(v['run.hardLimit'])} 秒；达到即失败，续时不延长此上限。`), element('p', '', `估算与名义预算差值：${Number.isFinite(c.activeSeconds) ? `${fmt(c.activeSeconds - c.budget)} 秒（正数表示超过）` : '不可达'}。仅供观察，不是可通关证明；暂停与局外耗时不计 active。`));
  const longTerm = card('04 / 巢穴永久成长的成本');
  longTerm.append(element('code', 'formula', '第 1–3 级 = 配置 cost1、cost2、cost3\n第 L ≥ 4 级 = ceil(cost3 × costGrowth^(L − 3))\n买满总成本 = Σ 四项升级 Σ 各级成本\n净成本 = max(0, 总成本 − initialFood)\n预计局数 = ceil(净成本 / foodPerRun)'), miniTable(['巢穴升级', '各级价格', '合计'], c.upgrades.map(upgrade => [upgrade.name, upgrade.costs.map(cost => fmt(cost, 0)).join(' / '), fmt(upgrade.total, 0)])), element('p', '', `毛成本 ${fmt(c.totalFood, 0)} 份 − 初始口粮 ${fmt(v['meta.initialFood'], 0)} 份 → 净成本 ${fmt(c.netFood, 0)} 份；按每局 ${fmt(v['estimate.foodPerRun'])} 份已结算净收益，约 ${fmt(c.foodRuns, 0)} 局。`), element('p', '', 'foodPerRun 已包含成败影响，不再乘 successRate，避免双算。成就奖励不计；从全新存档、零永久升级出发，不读取已有库存。这里的均值局数不是达成时间的概率保证。'));
  const lineage = card('05 / 基因与后代，不共用分母');
  lineage.append(element('code', 'formula', '基因买满 = gene.max × gene.cost\n难度 0 平均基因/局 = successRate × winGenes\n基因局数 = ceil(买满基因 / 平均基因每局)\n特质局数 = ceil(后代门槛 / (successRate × offspring))'), element('p', '', `基因 ${v['gene.max']} 级 × ${v['gene.cost']} 点 = ${fmt(c.geneCost)} 点；成功率 ${fmt(v['estimate.successRate'] * 100)}% × 胜利 ${v['settle.winGenes']} 点 = ${fmt(c.genePerRun)} 点/局，约 ${fmt(c.geneRuns)} 局。`), miniTable(['特质', '后代门槛', '平均后代/局', '预计局数'], traitNames.map(([id, name]) => [name, fmt(v[`trait.${id}.unlock`]), fmt(c.offspringPerRun), fmt(quotient(v[`trait.${id}.unlock`], c.offspringPerRun))])), element('p', '', '默认难度 0，不计成就、难度加成及已有基因/后代；0 收益且目标大于 0 时显示不可达，目标已为 0 则需 0 局。后代门槛不是购买消耗。'));
  const assumptions = card('06 / 哪些参数只是实验假设？');
  assumptions.append(element('p', '', 'estimate.* 单独分组，修改不影响游戏规则；填写自己的试玩观察，而不是把估算当作游戏表现。'), miniTable(['假设', '当前值'], fields.filter(field => field.group === '估算').map(field => [field.label, `${fmt(v[field.key])} ${field.unit}`])), element('p', '', '固定 seed 只能控制可复现的随机序列；操作路线、选卡、受击和暂停应单独记录。先写假设，再做单变量或两字段实验。'));
  grid.append(collection, pace, clock, longTerm, lineage, assumptions);
  $('experimentContent').replaceChildren(grid);
}
function summaryCard(title, lines) {
  const article = element('article', 'system-card');
  article.append(element('h4', '', title));
  const list = element('ul');
  lines.forEach(line => list.append(element('li', '', line)));
  article.append(list);
  return article;
}
function renderSystems(v, c) {
  const achievementCards = document.createDocumentFragment();
  for (const [id, name] of achievementNames) {
    const target = v[`achievements.${id}.target`];
    const condition = id === 'family' ? `累计后代 ≥ ${fmt(target)} 只` : id === 'collector' ? `已结算普通采集累计 ≥ ${fmt(target)} 次` : id === 'banker' ? `已交付口粮累计 ≥ ${fmt(target)} 份（不是总库存或结算奖励）` : id === 'swift' ? `至少胜利一次，最佳实际 active 时长 ≤ ${fmt(target)} 秒（不是剩余倒计时）` : `累计胜利 ≥ ${fmt(target)} 次`;
    const article = element('article');
    const heading = element('h4', '', name);
    heading.append(element('span', 'pill', v[`achievements.${id}.enabled`] ? '启用' : '关闭'));
    article.append(element('span', 'card-index', 'PLACEHOLDER · 待试玩'), heading, element('p', '', condition), element('p', 'reward', `一次性奖励：口粮 ${fmt(v[`achievements.${id}.food`])} / 基因 ${fmt(v[`achievements.${id}.genes`])}`), element('p', '', `字段 achievements.${id}.*；未进行成就平衡验证，不计入长线收益估算。`));
    achievementCards.append(article);
  }
  $('achievementCards').replaceChildren(achievementCards);
  const pct = value => `${fmt(value * 100)}%`;
  const effects = {
    swift: value => `每级移动速度 +${pct(value)}`,
    growth: value => `每级采集质量增长 +${pct(value)}`,
    magnet: value => `每级拾取范围 +${fmt(value)}`,
    endurance: value => `每级体力消耗降低 ${pct(value)}`,
    recovery: value => `每级体力回复 +${pct(value)}`,
    armor: value => `每级球损失减免 +${fmt(value * 100)} 个百分点`,
    insurance: value => `每级失败背包保留 +${fmt(value * 100)} 个百分点，合计最高 100%`,
    aroma: value => `每级金色养料额外香气 +${fmt(value)}`,
    jump: value => `每级跳跃速度 +${fmt(value)}`,
    thorns: value => `冲刺撞敌免伤，每级球损失减免 +${fmt(value * 100)} 个百分点`,
    bank: value => `每级交付质量折粮 +${pct(value)}，不加成背包`,
    vitality: value => `每级最大生命 +${fmt(value)} 并回复等量生命`,
  };
  const permanentEffects = { shell: '最大生命', seed: '初始球质量', legs: '移动速度比例', insurance: '失败背包保留比例' };
  $('systemSummary').replaceChildren(
    summaryCard('12 项常驻局内卡', perkNames.map(([id, name]) => `${name} · 上限 ${v[`perk.${id}.max`]} 级；${effects[id](v[`perk.${id}.value`])}${['armor', 'thorns'].includes(id) ? `；球损失合计减免上限 ${pct(v['perk.armorCap'])}` : ''}。`)),
    summaryCard('3 项即时卡 · 可重复获得', [`急救：立即回复 ${fmt(v['instant.heal'])} 生命，不超过最大生命。`, `余裕：倒计时 +${fmt(v['instant.clock'])} 秒，受 ${fmt(v['run.timeCap'])} 秒剩余上限限制，不延长 active 硬上限。`, `口粮：背包 +${fmt(v['instant.cash'])} 份，需交付或结算后入库。`, `普通采集每 ${v['run.draftEvery']} 次选卡，每次 ${v['run.draftChoices']} 张；初始重抽 ${v['run.rerolls']} 次。`]),
    summaryCard('4 项巢穴永久升级', c.upgrades.map(upgrade => `${upgrade.name} · ${v[`upgrade.${upgrade.id}.max`]} 级；每级${permanentEffects[upgrade.id]} +${fmt(v[`upgrade.${upgrade.id}.value`])}；买满 ${fmt(upgrade.total, 0)} 口粮。`)),
    summaryCard('3 项特质 · 后代门槛', traitNames.map(([id, name]) => `${name} · ${fmt(v[`trait.${id}.unlock`])} 后代解锁；速度 ×${fmt(v[`trait.${id}.speed`])}，生长 ×${fmt(v[`trait.${id}.growth`])}，生命 ${v[`trait.${id}.hp`] >= 0 ? '+' : ''}${v[`trait.${id}.hp`]}；最低最大生命 ${v['run.minHp']}。`)),
    summaryCard('基因 · 首球起点', [`上限 ${v['gene.max']} 级，每级 ${v['gene.cost']} 基因；每级首球香气 +${v['gene.aromaPerLevel']}。`, '基因香气仅首球，交付后归零；不是每颗球自动续杯。本页采集测算按零基因计算。', `难度 0 胜利获得 ${v['settle.winGenes']} 基因、${v['settle.offspring']} 后代。`]),
    summaryCard('难度与结算', [`难度上限 ${v['difficulty.max']}；每难度胜利口粮 +${v['settle.difficultyFood']}，基因 +${v['settle.difficultyGenes']}。`, `敌人追击每难度速度 +${v['enemy.difficultySpeed']}；鸟袭间隔每难度减少 ${v['bird.difficultyReduction']} 秒，最短 ${v['bird.minInterval']} 秒。`, `胜利基础口粮 ${v['settle.winFood']}；失败基础保留 ${pct(v['settle.failKeep'])}，撤退最低保留 ${pct(v['settle.retreatKeep'])}；已交付口粮不再损失。`, '长线测算固定难度 0，不将难度加成伪装成基准收益。'])
  );
}
function refresh() {
  const result = inspectDraft();
  let changed = 0;
  let pending = 0;
  for (const field of fields) {
    const view = rowViews.get(field.key);
    const parsed = parseField(field, draft[field.key]);
    const dirty = isChanged(field);
    if (dirty) changed++;
    if (parsed.error || parsed.value !== applied.values[field.key]) pending++;
    if (view.input.value !== draft[field.key]) view.input.value = draft[field.key];
    view.row.classList.toggle('is-changed', dirty);
    view.row.classList.toggle('is-invalid', Boolean(parsed.error));
    view.input.setAttribute('aria-invalid', String(Boolean(parsed.error)));
    view.error.textContent = parsed.error || '';
    view.reset.disabled = !dirty;
  }
  $('changedCount').textContent = String(changed);
  $('pendingCount').textContent = pending ? `${pending} 项未入本页快照` : '草稿与本页快照一致';
  $('revision').textContent = `draft revision ${result.ok ? revision(result.envelope.values) : '无效，未生成'} / applied ${revision(applied.values)}（${appliedLabel}，非游戏应用状态）/ 游戏实际 revision 未知`;
  $('exportConfigBtn').disabled = !result.ok;
  $('exportReportBtn').disabled = !result.ok;
  filterRows();
  if (!result.ok) {
    ['metricPickups', 'metricDeliveries', 'metricTime', 'metricFood'].forEach(id => { $(id).textContent = '待修正'; });
    $('metricPickupsNote').textContent = '存在非法值，已停止测算，不沿用旧结果';
    ['experimentContent', 'achievementCards', 'systemSummary'].forEach(id => { $(id).replaceChildren(element('p', 'warning-box', `当前草稿无效，暂停摘要与测算：${result.error}`)); });
    return result;
  }
  const v = result.envelope.values;
  const c = calculate(v);
  $('metricPickups').textContent = `${fmt(c.ordinary + c.gold, 0)} 次`;
  $('metricPickupsNote').textContent = `普通 ${fmt(c.ordinary, 0)} + 金色 ${fmt(c.gold, 0)} · 采集者 / 零基因`;
  $('metricDeliveries').textContent = `${fmt(c.deliveries, 0)} 次`;
  $('metricTime').textContent = `${fmt(v['run.baseTime'])} 秒 / ${v['run.hardLimit'] === 0 ? '关闭' : `${fmt(v['run.hardLimit'])} 秒`}`;
  $('metricFood').textContent = `${fmt(c.totalFood, 0)} 份`;
  renderExperiments(v, c);
  renderSystems(v, c);
  return result;
}
function exportReport() {
  const result = inspectDraft();
  if (!result.ok) { message(`禁止导出汇总：${result.error}`, 'error'); return false; }
  try {
    const doc = document.implementation.createHTMLDocument('生命远征 · 数值汇总');
    doc.documentElement.lang = 'zh-CN';
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'UTF-8');
    const viewport = doc.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    const style = doc.createElement('style');
    style.textContent = 'body{font:14px/1.8 system-ui,sans-serif;background:#f6f4ec;color:#253b30;margin:24px auto;padding:0 20px;max-width:1300px}h1,h2,h3,h4{color:#234f3c}table{width:100%;border-collapse:collapse;margin:15px 0}td,th{border:1px solid #d6decc;padding:8px;text-align:left;vertical-align:top}th{background:#e7eee2}code{white-space:pre-wrap;overflow-wrap:anywhere}.formula{display:block;background:#e7eee2;padding:14px}article{background:#fffef9;padding:18px;margin:16px 0;border-radius:12px}.mini-scroll,.report-scroll{overflow-x:auto}.big-result{font-size:25px}.pill{margin-left:12px}.card-index{color:#805a30}';
    doc.head.append(charset, viewport, style);
    doc.body.append(element('h1', '', '生命远征 · 数值汇总'), element('p', '', `配置 revision：${revision(result.envelope.values)} · ${new Date().toLocaleString('zh-CN')} · 完整字段 ${fields.length} 项`), element('p', '', '这是当前合法草稿的静态报告，不是游戏已应用证明。估算无构筑、零永久升级、零基因、采集者、难度 0；非 Monte Carlo、非平衡验证。成就为 PLACEHOLDER 待试玩。'), element('h2', '', '节奏与长线实验'));
    doc.body.append($('experimentContent').cloneNode(true), element('h2', '', '成就摘要'), $('achievementCards').cloneNode(true), element('h2', '', '系统与资源'), $('systemSummary').cloneNode(true), document.querySelector('.resource-note').cloneNode(true), element('h2', '', '全部配置字段'));
    const table = miniTable(['key', '中文名', '当前值', '默认值', '单位', '范围', '说明与影响'], fields.map(field => [field.key, field.label, result.envelope.values[field.key], field.default, field.unit, `${field.min} – ${field.max}${field.integer ? ' 整数' : ''}`, `${field.help} ${field.impact}`]));
    table.className = 'report-scroll';
    doc.body.append(table);
    download(new Blob(['<!doctype html>\n', doc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' }), '生命远征-数值汇总.html');
    message('已发起数值汇总 HTML 下载：包含全部字段、透明公式、系统和成就摘要。此报告不能代替配置 JSON 导入游戏。', 'success');
    return true;
  } catch (cause) { message(`汇总下载失败：${cause.message}。草稿未改变。`, 'error'); return false; }
}

buildRows();
loadDraft();
const initial = refresh();
message(initial.ok ? '草稿已就绪。所有测算只针对本页草稿；校验、下载并在游戏营地导入后，才会影响新局。' : `已保留草稿中的非法输入：${initial.error}。请修正后再导出。`, initial.ok ? 'info' : 'error');
$('searchInput').addEventListener('input', filterRows);
$('onlyChanged').addEventListener('change', filterRows);
$('validateBtn').addEventListener('click', validateDraft);
$('exportConfigBtn').addEventListener('click', exportConfig);
$('exportReportBtn').addEventListener('click', exportReport);
$('importConfigInput').addEventListener('change', readImport);
$('resetAllBtn').addEventListener('click', () => {
  if (!window.confirm('恢复全部默认值？这会替换本页草稿，不会修改游戏；尚未下载的本页改动将丢失。')) return;
  draft = Object.fromEntries(fields.map(field => [field.key, String(field.default)]));
  mutation++;
  saveDraft();
  refresh();
  message('草稿已恢复全部默认；applied 保持最近快照。请重新校验、下载，游戏配置不会自动改变。');
});
const tabs = [['fieldsTab', 'fieldsPanel'], ['experimentTab', 'experimentPanel'], ['systemsTab', 'systemsPanel']];
function activateTab(id) {
  tabs.forEach(([tabId, panelId]) => {
    const active = tabId === id;
    $(tabId).setAttribute('aria-selected', String(active));
    $(tabId).tabIndex = active ? 0 : -1;
    $(panelId).hidden = !active;
  });
}
tabs.forEach(([id], index) => {
  $(id).addEventListener('click', () => activateTab(id));
  $(id).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activateTab(tabs[next][0]);
    $(tabs[next][0]).focus();
  });
});
if (new URLSearchParams(window.location.search).get('test') === '1') {
  window.__tuning = Object.freeze({
    getDraft() {
      return { format: 'dung-balance-1', version: 1, values: Object.fromEntries(fields.map(field => { const parsed = parseField(field, draft[field.key]); return [field.key, parsed.error ? draft[field.key] : parsed.value]; })) };
    },
    setValue,
    validate: validateDraft,
    importConfig,
  });
}

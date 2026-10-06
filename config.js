// 数值配置边界：导入不读写持久化；只有显式 load 会读取本机配置。
const definitions = [];
function add(group, key, value, label, unit = '', min = 0, max = 10000, integer = false, help = '') {
  const placeholder = group === '成就';
  definitions.push(Object.freeze({
    key, group, label, unit, min, max, step: integer ? 1 : 0.01, integer, default: value,
    help: `${placeholder ? 'PLACEHOLDER：新增成就参数，待验证。' : 'legacy 默认兼容原规则，不代表已验证的平衡结论。'}${help}`,
    impact: group === '估算' ? '仅用于估算，不影响游戏；实际时长与倒计时预算分别计算。' : `${group}规则：${label}；修改后由规则或主层读取。`,
  }));
}
function rows(group, prefix, entries) {
  for (const [key, value, label, unit, min, max, integer, help] of entries) {
    add(group, `${prefix}.${key}`, value, label, unit, min, max, integer, help);
  }
}
rows('局内', 'run', [
  ['baseTime',210,'初始倒计时','秒',1,36000], ['timeCap',300,'倒计时上限','秒',1,36000],
  ['stageBonus',25,'阶段完成续时','秒',0,36000], ['baseHp',4,'基础生命','点',1,100,true],
  ['minHp',2,'最低最大生命','点',1,100,true], ['startMass',1,'基础初始质量','kg',0.1,1000],
  ['massCap',24,'质量上限','kg',0.1,1000], ['rerolls',1,'初始重抽次数','次',0,100,true],
  ['draftEvery',12,'普通采集选卡间隔','次',1,1000,true],
  ['hardLimit',0,'累计活跃时长上限','秒',0,36000,false,'0 为关闭；累计 active elapsed 达到上限即失败，续时不能延长实际时长上限。'],
  ['staminaCap',100,'体力上限','点',1,1000], ['draftChoices',3,'每次选卡数量','张',1,3,true],
]);
rows('采集', 'collect', [
  ['goldAroma',1,'金色养料香气','点',0,100,true], ['goldFood',3,'金色养料口粮','份',0,1000,true],
  ['normalFood',1,'普通养料口粮','份',0,1000,true], ['score',20,'普通采集基础分','分',0,10000,true],
  ['comboStep',3,'连击倍率步长','次',1,1000,true], ['comboMax',5,'连击最大倍率','倍',1,100,true],
  ['goldScore',60,'金色采集得分（主层发放）','分',0,10000,true],
]);
rows('交付', 'deliver', [
  ['foodPerKg',2,'质量折粮','份/kg',0,1000], ['scorePerKg',100,'质量得分','分/kg',0,10000],
  ['heal',1,'交付回血','点',0,100,true], ['invincible',3,'交付无敌','秒',0,120],
]);
rows('受击', 'hit', [
  ['hp',1,'生命损失','点',0,100,true], ['minMass',1.8,'最低基础质量损失','kg',0,1000],
  ['massRatio',0.25,'质量损失比例','比例',0,1], ['massFloor',1,'受击质量下限','kg',0.1,1000],
  ['aroma',1,'香气损失','点',0,100,true], ['time',4,'倒计时损失','秒',0,3600],
  ['invincible',2.2,'受击无敌','秒',0,120],
]);
rows('结算', 'settle', [
  ['failKeep',0.2,'失败基础口粮保留','比例',0,1], ['retreatKeep',0.6,'撤退最低口粮保留','比例',0,1],
  ['winFood',40,'胜利基础口粮','份',0,1000000,true], ['difficultyFood',10,'每难度胜利口粮','份',0,100000,true],
  ['winGenes',3,'胜利基础基因','点',0,10000,true], ['difficultyGenes',1,'每难度胜利基因','点',0,1000,true],
  ['offspring',2,'胜利后代','只',0,1000,true], ['timeScore',8,'剩余倒计时得分','分/秒',0,10000],
]);
add('局外','meta.initialFood',18,'初始口粮','份',0,1000000,true);
rows('基因','gene', [['max',2,'基因等级上限','级',0,20,true],['cost',3,'每级基因花费','点',0,10000,true],['aromaPerLevel',1,'每级初始香气','点',0,100,true]]);
add('难度','difficulty.max',10,'游戏难度上限','级',0,50,true);
for (const [index,mass,aroma,count] of [[0,6,0,2],[1,10,3,1],[2,8,1,2]]) {
  rows('阶段',`stage.${index}`, [['mass',mass,`阶段 ${index+1} 质量门槛`,'kg',0.1,1000],['aroma',aroma,`阶段 ${index+1} 香气门槛`,'点',0,1000,true],['count',count,`阶段 ${index+1} 交付次数`,'次',1,100,true]]);
}
for (const [id,name,value,unit,integer] of [['shell','厚实甲壳',1,'点',true],['seed','育球种子',0.5,'kg',false],['legs','强健足肢',0.05,'比例',false],['insurance','应急储备',0.15,'比例',false]]) {
  rows('永久升级',`upgrade.${id}`, [
    ['max',3,`${name}等级上限`,'级',1,20,true], ['cost1',12,`${name}第一级价格`,'份',0,1000000,true],
    ['cost2',24,`${name}第二级价格`,'份',0,1000000,true], ['cost3',40,`${name}第三级价格`,'份',0,1000000,true],
    ['costGrowth',1.6,`${name}后续价格增长`,'倍',1,5,false,'第四级起 ceil(cost3 × costGrowth^(购买等级−3))。'],
    ['value',value,`${name}每级效果`,unit,0,unit === '比例' ? 1 : 100,integer],
  ]);
}
for (const [id,name,unlock,speed,growth,hp] of [['forager','采集者',0,1,1.12,0],['runner','奔跑者',2,1.12,1,-1],['guardian','守护者',4,0.92,1,2]]) {
  rows('特质',`trait.${id}`, [
    ['unlock',unlock,`${name}解锁后代数`,'只',0,id==='forager'?0:1000000,true],
    ['speed',speed,`${name}速度倍率`,'倍',0.1,10], ['growth',growth,`${name}生长倍率`,'倍',0.1,10],
    ['hp',hp,`${name}生命增减`,'点',-100,100,true],
  ]);
}
for (const [id,name,value,unit,integer] of [
  ['swift','疾行',0.1,'比例',false],['growth','沃土',0.2,'比例',false],['magnet','吸附',0.55,'距离',false],
  ['endurance','耐力',0.15,'比例',false],['recovery','回春',0.25,'比例',false],['armor','护球',0.3,'比例',false],
  ['insurance','藏粮',0.1,'比例',false],['aroma','花香',1,'点',true],['jump','弹跳',1.5,'速度',false],
  ['thorns','荆棘',0.05,'比例',false],['bank','丰收',0.25,'比例',false],['vitality','生机',1,'点',true],
]) {
  rows('局内卡牌',`perk.${id}`, [['max',2,`${name}等级上限`,'级',1,5,true],['value',value,`${name}每级效果`,unit,0,unit==='比例'?1:100,integer]]);
}
add('局内卡牌','perk.armorCap',0.7,'球损失减免上限','比例',0,1);
rows('即时卡','instant', [['heal',2,'急救回复生命','点',0,100,true],['clock',20,'余裕增加倒计时','秒',0,36000],['cash',8,'口粮增加背包','份',0,10000,true]]);
rows('世界','world', [
  ['normalCount',132,'普通养料数量','个',8,300,true], ['goldCount',20,'金色养料数量','个',3,80,true],
  ['starterMass',0.9,'起始区养料质量','kg',0,100], ['normalMin',0.6,'普通养料最小质量','kg',0,100],
  ['normalMax',1.05,'普通养料最大质量','kg',0,100], ['outerBonus',1.6,'外围质量加成','倍',0,10],
  ['riskRadius',22,'高风险距离阈值','距离',15,29], ['normalRespawn',23,'普通养料重生','秒',0.1,3600],
  ['goldRespawn',26,'金色养料重生','秒',0.1,3600], ['pickupPadding',0.32,'拾取额外半径','距离',0,10],
]);
rows('移动','move', [
  ['walk',5.4,'行走速度','距离/秒',0.1,100], ['dash',10,'冲刺速度','距离/秒',0.1,100],
  ['drain',28,'冲刺体力消耗','点/秒',0,1000], ['regen',17,'体力回复','点/秒',0,1000],
  ['water',0.48,'水域速度倍率','倍',0.01,5], ['rain',0.86,'雨天速度倍率','倍',0.01,5],
  ['drought',1.35,'旱天体力消耗倍率','倍',0.01,10], ['weatherPeriod',32,'天气周期','秒',1,3600], ['jump',7,'基础跳跃速度','速度',0.1,100],
]);
rows('敌人','enemy', [
  ['baseCount',3,'初始敌人数','只',0,3,true], ['perStage',1,'每阶段增加敌人','只',0,1,true],
  ['chase',2.65,'追击速度','距离/秒',0,100], ['stageSpeed',0.25,'每阶段速度增量','距离/秒',0,10],
  ['patrol',1.6,'巡逻速度','距离/秒',0,100], ['difficultySpeed',0.12,'每难度敌速加成','比例',0,10],
]);
rows('鸟袭','bird', [
  ['first',11,'首次鸟袭等待','秒',0,3600], ['baseInterval',13,'基础鸟袭间隔','秒',0.1,3600],
  ['minInterval',4,'最短鸟袭间隔','秒',0.1,3600], ['stageReduction',1.8,'阶段间隔减量','秒',0,120],
  ['difficultyReduction',0.35,'难度间隔减量','秒',0,120], ['riskReduction',4,'高风险间隔减量','秒',0,120],
  ['warning',1.6,'鸟袭预警时长','秒',0.1,120], ['radius',2.8,'鸟袭命中半径','距离',0.1,30],
]);
rows('遗物','relic', [['time',12,'遗物交易扣除时间','秒',0,3600],['food',12,'遗物口粮','份',0,100000,true]]);
for (const [id,name,target,food,genes] of [['first_win','初次育婴',1,12,0],['family','繁衍家族',10,24,1],['veteran','远征老手',10,40,2],['collector','采集达人',200,20,0],['banker','储粮专家',1000,40,1],['swift','速战速决',120,30,1]]) {
  rows('成就',`achievements.${id}`, [
    ['target',target,`${name}目标`,id==='swift'?'实际秒数':'累计次数',1,1000000000,id!=='swift'],
    ['food',food,`${name}口粮奖励`,'份',0,1000000,true], ['genes',genes,`${name}基因奖励`,'点',0,10000,true],
    ['enabled',1,`${name}启用`,'0/1',0,1,true],
  ]);
}
rows('估算','estimate', [
  ['pickupsPerMinute',18,'每分钟采集次数','次/分钟',0.1,1000], ['distancePerDelivery',30,'每次交付移动距离','距离',0,10000],
  ['travelSpeed',4,'估算移动速度','距离/秒',0.1,100], ['successRate',0.6,'估算成功率','比例',0,1],
  ['foodPerRun',100,'估算每局口粮','份',0,1000000], ['sessionOverhead',40,'局外及暂停开销','秒',0,36000,false,'属于现实会话耗时，不计入 active elapsed，也不消耗局内倒计时。'],
]);

const fields = Object.freeze(definitions);
const defaults = Object.freeze(Object.fromEntries(fields.map(item => [item.key,item.default])));
const keys = fields.map(item => item.key);
function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} 必须是普通对象`);
  if (Reflect.ownKeys(value).some(key => !allowed.includes(key))) throw new Error(`${label} 包含未知字段`);
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !Object.hasOwn(descriptor,'value')) throw new Error(`${label} 缺少或非法字段：${key}`);
  }
}
function validate(input) {
  record(input,['format','version','values'],'配置');
  if (input.format !== 'dung-balance-1' || input.version !== 1) throw new Error('不支持的配置格式或版本');
  record(input.values,keys,'values');
  const values = {};
  for (const item of fields) {
    const value = input.values[item.key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < item.min || value > item.max || (item.integer && !Number.isSafeInteger(value))) {
      throw new Error(`${item.key} 必须是 ${item.min} 至 ${item.max} 的有限${item.integer?'整数':'数字'}`);
    }
    values[item.key] = Object.is(value,-0) ? 0 : value;
  }
  const require = (condition,message) => { if (!condition) throw new Error(message); };
  require(values['run.baseTime'] <= values['run.timeCap'],'初始倒计时不能超过倒计时上限');
  require(values['run.minHp'] <= values['run.baseHp'],'最低生命不能超过基础生命');
  require(values['run.startMass'] + values['upgrade.seed.value'] * values['upgrade.seed.max'] <= values['run.massCap'],'初始质量加满级种子不能超过质量上限');
  require(values['hit.massFloor'] <= values['run.startMass'],'受击质量下限不能超过初始质量');
  require(values['world.normalMin'] <= values['world.normalMax'],'普通养料最小质量不能超过最大质量');
  require(values['enemy.baseCount'] + 2*values['enemy.perStage'] <= 5,'末阶段敌人数不能超过 5');
  require(values['bird.minInterval'] <= values['bird.baseInterval'],'鸟袭最短间隔不能超过基础间隔');
  require(values['move.dash'] >= values['move.walk'],'冲刺速度不能低于行走速度');
  require(values['perk.endurance.value'] * values['perk.endurance.max'] <= 0.9,'耐力满级消耗减免不能超过 90%');
  for (let index=0; index<3; index++) {
    require(values[`stage.${index}.mass`] <= values['run.massCap'],'阶段目标质量不能超过质量上限');
    require(values[`stage.${index}.aroma`] === 0 || (values['world.goldCount'] > 0 && values['collect.goldAroma'] > 0),'阶段香气必须可由金色养料获得');
  }
  for (const id of ['shell','seed','legs','insurance']) {
    require(Math.ceil(values[`upgrade.${id}.cost3`] * values[`upgrade.${id}.costGrowth`] ** Math.max(0,values[`upgrade.${id}.max`]-3)) <= 1e12,'最高升级价格不能超过存档口粮上限');
  }
  return {format:'dung-balance-1',version:1,values};
}
function hash(values) {
  let result = 2166136261;
  for (const char of JSON.stringify(values)) result = Math.imul(result ^ char.charCodeAt(0),16777619) >>> 0;
  return result.toString(16).padStart(8,'0');
}
let current = {format:'dung-balance-1',version:1,values:{...defaults}};
let revision = hash(current.values);
let error = '';
const snapshot = () => ({format:current.format,version:current.version,values:{...current.values}});
function apply(input) {
  const next = validate(input);
  const nextRevision = hash(next.values);
  current = next;
  revision = nextRevision;
  error = '';
  return snapshot();
}
export const Config = Object.freeze({
  fields, defaults, legacy: defaults,
  get(key) { return Object.hasOwn(current.values,key) ? current.values[key] : undefined; },
  validate, export: snapshot, apply,
  reset() { return apply({format:'dung-balance-1',version:1,values:{...defaults}}); },
  get revision() { return revision; },
  get error() { return error; },
  load() {
    try {
      const raw = globalThis.localStorage.getItem('dung-balance-v1');
      if (raw === null) { error = ''; return snapshot(); }
      return apply(JSON.parse(raw));
    } catch (cause) {
      error = `读取数值配置失败：${cause instanceof Error ? cause.message : String(cause)}`;
      return null;
    }
  },
  describe() { return {baseline:'legacy',fields,defaults,revision,time:'倒计时预算可续时；实际活跃时长由 elapsed 累计，hardLimit=0 时不限。估算字段不影响规则。'}; },
});

// 纯规则模块：不访问宿主 API、时钟或全局随机数。
import { Config } from './config.js';
const C = key => Config.get(key);
const MAX_CURRENCY = 1_000_000_000_000;
const MAX_COUNT = 1_000_000_000;
const MAX_DIFFICULTY = 50;
const MAX_SEED = 0xffffffff;
const upgradeNames = [['shell','厚实甲壳'],['seed','育球种子'],['legs','强健足肢'],['insurance','应急储备']];
const traitNames = [['forager','采集者'],['runner','奔跑者'],['guardian','守护者']];
const perkNames = [
  ['swift','疾行','移动'],['growth','沃土','采集'],['magnet','吸附','采集'],['endurance','耐力','体力'],
  ['recovery','回春','体力'],['armor','护球','防御'],['insurance','藏粮','储备'],['aroma','花香','香气'],
  ['jump','弹跳','移动'],['thorns','荆棘','防御'],['bank','丰收','储备'],['vitality','生机','生命'],
  ['heal','急救','即时'],['clock','余裕','即时'],['cash','口粮','即时'],
];
const instantIds = ['heal','clock','cash'];
const stageNames = ['储粮过冬','芳香求偶','育婴新生'];
const achievementNames = [['first_win','初次育婴'],['family','繁衍家族'],['veteran','远征老手'],['collector','采集达人'],['banker','储粮专家'],['swift','速战速决']];
const percent = value => Number((value * 100).toFixed(8));
const frozenList = items => Object.freeze(items.map(Object.freeze));

function upgrades() {
  return frozenList(upgradeNames.map(([id,name]) => {
    const value = C(`upgrade.${id}.value`);
    const max = C(`upgrade.${id}.max`);
    const description = {
      shell: `每级最大生命 +${value}。`, seed: `每级初始球质量 +${value}。`,
      legs: `每级移动速度 +${percent(value)}%。`,
      insurance: `失败基础保留背包 ${percent(C('settle.failKeep'))}%，每级再增加 ${percent(value)} 个百分点，最高 100%。`,
    }[id];
    const cost = Object.freeze(Array.from({length:max},(_,index) => index<3 ? C(`upgrade.${id}.cost${index+1}`) : Math.ceil(C(`upgrade.${id}.cost3`) * C(`upgrade.${id}.costGrowth`) ** (index-2))));
    return {id,name,description,max,cost,value};
  }));
}
function traits() {
  return frozenList(traitNames.map(([id,name]) => {
    const speed = C(`trait.${id}.speed`), growth = C(`trait.${id}.growth`), hp = C(`trait.${id}.hp`);
    return {id,name,requireOffspring:C(`trait.${id}.unlock`),speed,growth,hp,
      description:`速度 ×${speed}，采集质量增长 ×${growth}，最大生命 ${hp>=0?'+':''}${hp}，最低为 ${C('run.minHp')}。`};
  }));
}
function perks() {
  return frozenList(perkNames.map(([id,name,tag]) => {
    const value = C(`${tag==='即时'?'instant':'perk'}.${id}${tag==='即时'?'':'.value'}`);
    const description = {
      swift:`每级移动速度 +${percent(value)}%。`, growth:`每级采集质量增长 +${percent(value)}%。`,
      magnet:`每级额外拾取范围 +${value}。`, endurance:`每级体力消耗降低 ${percent(value)}%。`,
      recovery:`每级体力回复 +${percent(value)}%。`,
      armor:`每级球损失减免 +${percent(value)} 个百分点，总减免最高 ${percent(C('perk.armorCap'))}%。`,
      insurance:`每级失败背包保留比例 +${percent(value)} 个百分点，最高 100%。`,
      aroma:`每级金色养料额外提供 ${value} 点香气。`, jump:`每级额外跳跃速度 +${value}。`,
      thorns:`冲刺撞敌免伤；每级另加 ${percent(value)} 个百分点球损失减免。`,
      bank:`每级交付时球质量折粮奖励 +${percent(value)}%，不加成背包。`,
      vitality:`每级最大生命 +${value}，并回复 ${value} 点生命。`,
      heal:`立即回复 ${value} 点生命，可重复获得。`,
      clock:`立即增加 ${value} 秒倒计时，最多 ${C('run.timeCap')} 秒，可重复获得；不延长累计活跃时长上限。`,
      cash:`立即获得 ${value} 份背包口粮，可重复获得。`,
    }[id];
    // 即时卡的 max 仅保留旧展示契约，不限制领取次数。
    return {id,name,tag,description,value,max:tag==='即时'?2:C(`perk.${id}.max`)};
  }));
}
function targets() {
  return frozenList(stageNames.map((name,index) => {
    const mass=C(`stage.${index}.mass`), aroma=C(`stage.${index}.aroma`), count=C(`stage.${index}.count`);
    return {name,mass,aroma,count,description:`交付 ${count} 次，每次球质量至少 ${mass}，${aroma ? `香气至少 ${aroma}` : '无香气要求'}。`};
  }));
}

function freshMeta() {
  return {
    version:2, food:C('meta.initialFood'), genes:0, offspring:0, wins:0, runs:0, best:0,
    upgrades:{shell:0,seed:0,legs:0,insurance:0}, trait:'forager', difficulty:0, activeRun:null,
    stats:{collected:0,banked:0,bestWinSeconds:null}, claimed:[],
  };
}
function plainObject(value,label) {
  if (value===null || typeof value!=='object' || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} 必须是普通对象`);
}
function whitelist(value,keys,label) {
  plainObject(value,label);
  if (Reflect.ownKeys(value).some(key=>!keys.includes(key))) throw new Error(`${label} 包含非白名单字段`);
}
function field(value,key) {
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if (!descriptor || !Object.hasOwn(descriptor,'value')) throw new Error(`缺少或非法字段：${key}`);
  return descriptor.value;
}
function integer(value,max,label) {
  if (!Number.isSafeInteger(value) || value<0 || value>max) throw new Error(`${label} 必须是 0 至 ${max} 的整数`);
  return value;
}
function seconds(value) {
  // elapsed 是逐帧累计的真实小数秒；不取整，不接受字符串、负数、NaN 或无限值。
  if (typeof value!=='number' || !Number.isFinite(value) || value<0 || value>MAX_COUNT) throw new Error('bestWinSeconds 必须是有限非负秒数，且不超过统计上限');
  return value;
}
function validateMeta(input) {
  const output=freshMeta();
  whitelist(input,Object.keys(output),'meta');
  if (field(input,'version')!==2) throw new Error('不支持的存档版本');
  for (const key of ['food','genes','offspring','wins','runs','best']) output[key]=integer(field(input,key),['food','best'].includes(key)?MAX_CURRENCY:MAX_COUNT,key);
  const savedUpgrades=field(input,'upgrades');
  whitelist(savedUpgrades,upgradeNames.map(([id])=>id),'upgrades');
  for (const [id] of upgradeNames) output.upgrades[id]=integer(field(savedUpgrades,id),20,id);
  output.trait=field(input,'trait');
  if (!traitNames.some(([id])=>id===output.trait)) throw new Error('特质不存在');
  output.difficulty=integer(field(input,'difficulty'),MAX_DIFFICULTY,'difficulty');
  const activeRun=field(input,'activeRun');
  if (activeRun!==null) {
    plainObject(activeRun,'activeRun');
    output.activeRun={banked:integer(field(activeRun,'banked'),MAX_CURRENCY,'activeRun.banked'),startedSeed:integer(field(activeRun,'startedSeed'),MAX_SEED,'activeRun.startedSeed')};
  }
  if (Object.hasOwn(input,'stats')) {
    const saved=field(input,'stats');
    whitelist(saved,['collected','banked','bestWinSeconds'],'stats');
    output.stats.collected=integer(field(saved,'collected'),MAX_COUNT,'stats.collected');
    output.stats.banked=integer(field(saved,'banked'),MAX_CURRENCY,'stats.banked');
    const best=field(saved,'bestWinSeconds');
    output.stats.bestWinSeconds=best===null ? null : seconds(best);
    if (best!==null && output.wins===0) throw new Error('未获胜存档不能包含最佳胜利时长');
  }
  if (Object.hasOwn(input,'claimed')) {
    const claimed=field(input,'claimed');
    if (!Array.isArray(claimed) || claimed.length>achievementNames.length || Reflect.ownKeys(claimed).some(key=>key!=='length' && !Array.from({length:claimed.length},(_,index)=>String(index)).includes(key))) throw new Error('claimed 必须是成就 ID 数组');
    for (let index=0;index<claimed.length;index++) {
      const id=field(claimed,String(index));
      if (!achievementNames.some(([known])=>known===id) || output.claimed.includes(id)) throw new Error('claimed 包含未知或重复成就');
      output.claimed.push(id);
    }
  }
  return output;
}
// 旧版二代存档不伪造历史采集、交付和胜利耗时，仅在需要写统计时补齐。
function ensureStats(meta) {
  if (!Object.hasOwn(meta,'stats')) meta.stats={collected:0,banked:0,bestWinSeconds:null};
  if (!Object.hasOwn(meta,'claimed')) meta.claimed=[];
}
function initRun(s,meta,seed,trait='forager',difficulty=0) {
  const checked=validateMeta(meta);
  integer(seed,MAX_SEED,'seed');
  integer(difficulty,MAX_DIFFICULTY,'difficulty');
  const selectedTrait=traits().find(item=>item.id===trait);
  if (!selectedTrait) throw new Error('特质不存在');
  if (checked.offspring<selectedTrait.requireOffspring) trait='forager';
  if (difficulty>checked.difficulty) throw new Error('难度尚未解锁');
  difficulty=Math.min(difficulty,C('difficulty.max'));
  const startMass=C('run.startMass')+C('upgrade.seed.value')*Math.min(checked.upgrades.seed,C('upgrade.seed.max'));
  Object.assign(s,{
    time:C('run.baseTime'),score:0,mass:startMass,startMass,stamina:C('run.staminaCap'),
    stage:0,stageDelivered:0,delivered:0,aroma:0,pocket:0,banked:0,genesEarned:0,perks:{},rng:seed,
    elapsed:0,settled:false,result:null,completed:false,hardTimedOut:false,
    hitCount:0,risk:0,drafts:0,rerolls:C('run.rerolls'),stageDrafts:0,
    trait,difficulty,metaSnapshot:{upgrades:{...checked.upgrades}},collected:0,combo:0,invincible:0,
  });
  s.maxHp=stats(s).maxHp;
  s.hp=s.maxHp;
  return s;
}
function target(s) { return targets()[s.stage]; }
function ready(s) {
  const goal=target(s);
  return Boolean(goal && s.mass>=goal.mass && s.aroma>=goal.aroma);
}
function stats(s) {
  const level=id=>Math.min(s.metaSnapshot.upgrades[id],C(`upgrade.${id}.max`));
  const rank=id=>Math.min(Object.hasOwn(s.perks,id)?s.perks[id]:0,C(`perk.${id}.max`));
  const effect=id=>C(`perk.${id}.value`)*rank(id);
  const trait=traitNames.some(([id])=>id===s.trait)?s.trait:'forager';
  return {
    speed:C(`trait.${trait}.speed`)*(1+C('upgrade.legs.value')*level('legs'))*(1+effect('swift')),
    growth:C(`trait.${trait}.growth`)*(1+effect('growth')),
    magnet:effect('magnet'),drain:1-effect('endurance'),regen:1+effect('recovery'),
    armor:Math.min(C('perk.armorCap'),effect('armor')+effect('thorns')),
    // 使用百分点合成，保持 legacy 保险在 floor 边界的结果（例如 100 × 35%）。
    insurance:Math.min(1,(C('settle.failKeep')*100+C('upgrade.insurance.value')*100*level('insurance')+C('perk.insurance.value')*100*rank('insurance'))/100),
    aromaBonus:effect('aroma'),jump:effect('jump'),thorns:rank('thorns')>0,bankBonus:1+effect('bank'),
    maxHp:Math.max(C('run.minHp'),C('run.baseHp')+C('upgrade.shell.value')*level('shell')+C(`trait.${trait}.hp`))+effect('vitality'),
  };
}
function collect(s,value,gold=false) {
  if (s.settled || s.hardTimedOut) return {massGain:0,aromaGain:0,levelUp:false};
  const attributes=stats(s);
  if (gold) {
    const aromaGain=C('collect.goldAroma')+attributes.aromaBonus;
    s.stamina=C('run.staminaCap');
    s.aroma+=aromaGain;
    s.pocket+=C('collect.goldFood');
    // 金色分数沿用主层发放职责，避免旧主层重复计分。
    return {massGain:0,aromaGain,levelUp:false};
  }
  if (typeof value!=='number' || !Number.isFinite(value) || value<0) throw new Error('采集质量必须是有限非负数');
  const previousMass=s.mass;
  s.mass=Math.min(C('run.massCap'),s.mass+value*attributes.growth);
  s.collected++;
  s.pocket+=C('collect.normalFood');
  s.combo++;
  s.score+=C('collect.score')*Math.min(C('collect.comboMax'),Math.ceil(s.combo/C('collect.comboStep')));
  return {massGain:s.mass-previousMass,aromaGain:0,levelUp:s.collected%C('run.draftEvery')===0};
}
function random(s) {
  s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0;
  return s.rng/4294967296;
}
function draft(s) {
  if (s.settled || s.hardTimedOut) return [];
  const pool=perks().filter(perk=>perk.tag!=='即时' && (s.perks[perk.id]||0)<perk.max).map(perk=>perk.id);
  const offered=[];
  while (offered.length<C('run.draftChoices')) {
    if (pool.length===0) pool.push(...instantIds);
    const index=Math.floor(random(s)*pool.length);
    offered.push(pool.splice(index,1)[0]);
  }
  s.drafts++;
  s.stageDrafts++;
  return offered;
}
function select(s,id,offered) {
  if (s.settled || s.hardTimedOut || !Array.isArray(offered) || !offered.includes(id)) return false;
  const perk=perks().find(item=>item.id===id);
  if (!perk) return false;
  if (perk.tag==='即时') {
    if (id==='heal') s.hp=Math.min(stats(s).maxHp,s.hp+C('instant.heal'));
    if (id==='clock') s.time=Math.min(C('run.timeCap'),s.time+C('instant.clock'));
    if (id==='cash') s.pocket+=C('instant.cash');
    return true;
  }
  const rank=s.perks[id]||0;
  if (rank>=perk.max) return false;
  s.perks[id]=rank+1;
  s.maxHp=stats(s).maxHp;
  if (id==='vitality') s.hp=Math.min(s.maxHp,s.hp+C('perk.vitality.value'));
  return true;
}
function deliver(s,meta) {
  if (s.settled || s.hardTimedOut || s.completed || !ready(s)) return {ok:false,stageChange:false,won:false,banked:0};
  const goal=target(s);
  const banked=s.pocket+Math.floor(s.mass*C('deliver.foodPerKg')*stats(s).bankBonus);
  ensureStats(meta);
  meta.food=Math.min(MAX_CURRENCY,meta.food+banked);
  meta.stats.banked=Math.min(MAX_CURRENCY,meta.stats.banked+banked);
  s.banked+=banked;
  s.pocket=0;
  s.score+=Math.round(s.mass*C('deliver.scorePerKg'));
  s.stageDelivered++;
  s.delivered++;
  s.startMass=C('run.startMass')+C('upgrade.seed.value')*Math.min(s.metaSnapshot.upgrades.seed,C('upgrade.seed.max'));
  s.mass=s.startMass;
  s.aroma=0;
  s.stamina=C('run.staminaCap');
  s.maxHp=stats(s).maxHp;
  s.hp=Math.min(s.maxHp,s.hp+C('deliver.heal'));
  s.invincible=C('deliver.invincible');
  let stageChange=false,won=false;
  if (s.stageDelivered>=goal.count) {
    s.stageDelivered=0;
    s.stageDrafts=0;
    s.time=Math.min(C('run.timeCap'),s.time+C('run.stageBonus'));
    if (s.stage<stageNames.length-1) { s.stage++;stageChange=true; }
    else { s.completed=true;won=true; }
  }
  return {ok:true,stageChange,won,banked};
}
function hit(s) {
  if (s.invincible>0 || s.settled || s.hardTimedOut) return {hit:false,dead:false,loss:0};
  const previousMass=s.mass;
  s.hp=Math.max(0,s.hp-C('hit.hp'));
  s.mass=Math.max(C('hit.massFloor'),s.mass-Math.max(C('hit.minMass'),s.mass*C('hit.massRatio'))*(1-stats(s).armor));
  s.aroma=Math.max(0,s.aroma-C('hit.aroma'));
  s.time=Math.max(0,s.time-C('hit.time'));
  s.invincible=C('hit.invincible');
  s.combo=0;
  s.hitCount++;
  return {hit:true,dead:s.hp===0,loss:previousMass-s.mass};
}
function tick(s,dt) {
  if (s.settled || s.hardTimedOut) return;
  if (typeof dt!=='number' || !Number.isFinite(dt) || dt<0) throw new Error('dt 必须是有限非负数');
  s.time=Math.max(0,s.time-dt);
  s.elapsed+=dt;
  s.invincible=Math.max(0,s.invincible-dt);
  if (C('run.hardLimit')>0 && s.elapsed>=C('run.hardLimit')) { s.time=0;s.hardTimedOut=true; }
}
function settle(s,meta,outcome) {
  if (s.settled) return s.result;
  if (!['win','fail','retreat'].includes(outcome)) throw new Error('未知结算结果');
  if (s.hardTimedOut || (C('run.hardLimit')>0 && s.elapsed>=C('run.hardLimit'))) { outcome='fail';s.time=0;s.hardTimedOut=true; }
  const pocket=s.pocket,won=outcome==='win';
  const elapsed=won?seconds(s.elapsed):null;
  const recovered=won ? pocket+C('settle.winFood')+C('settle.difficultyFood')*s.difficulty : Math.floor(pocket*(outcome==='retreat'?Math.max(C('settle.retreatKeep'),stats(s).insurance):stats(s).insurance));
  const genes=won?C('settle.winGenes')+C('settle.difficultyGenes')*s.difficulty:0;
  const offspring=won?C('settle.offspring'):0;
  if (won) s.score+=Math.round(s.time*C('settle.timeScore'));
  ensureStats(meta);
  meta.food=Math.min(MAX_CURRENCY,meta.food+recovered);
  meta.genes=Math.min(MAX_COUNT,meta.genes+genes);
  meta.offspring=Math.min(MAX_COUNT,meta.offspring+offspring);
  meta.stats.collected=Math.min(MAX_COUNT,meta.stats.collected+s.collected);
  if (won) {
    meta.wins=Math.min(MAX_COUNT,meta.wins+1);
    meta.stats.bestWinSeconds=meta.stats.bestWinSeconds===null?elapsed:Math.min(meta.stats.bestWinSeconds,elapsed);
  }
  meta.runs=Math.min(MAX_COUNT,meta.runs+1);
  meta.best=Math.min(MAX_CURRENCY,Math.max(meta.best,s.score));
  meta.activeRun=null;
  s.genesEarned+=genes;
  s.pocket=0;
  s.settled=true;
  s.result={
    outcome,recovered,lost:won?0:pocket-recovered,banked:s.banked,genes,offspring,score:s.score,
    reasonLabel:s.hardTimedOut?'累计时长上限':won?'育婴成功':outcome==='retreat'?'主动撤退':s.hp<=0?'生命耗尽':s.time<=0?'时间耗尽':'挑战失败',
  };
  return s.result;
}
function buy(meta,id) {
  const upgrade=upgrades().find(item=>item.id===id);
  if (!upgrade) return false;
  const tier=meta.upgrades[id];
  if (!Number.isInteger(tier) || tier<0 || tier>=upgrade.max) return false;
  const cost=upgrade.cost[tier];
  if (!Number.isFinite(meta.food) || meta.food<cost) return false;
  meta.food-=cost;
  meta.upgrades[id]++;
  return true;
}
function achievements(meta) {
  return achievementNames.map(([id,name])=>{
    const target=C(`achievements.${id}.target`);
    const progress=id==='family'?meta.offspring:id==='collector'?(meta.stats?.collected??0):id==='banker'?(meta.stats?.banked??0):id==='swift'?(meta.stats?.bestWinSeconds??null):meta.wins;
    const unlocked=C(`achievements.${id}.enabled`)===1 && (id==='swift'?meta.wins>0 && progress!==null && progress<=target:progress>=target);
    const description=id==='swift'?`至少胜利一次，最佳实际活跃时长不超过 ${target} 秒（非剩余倒计时）。`:id==='family'?`累计后代达到 ${target} 只。`:id==='collector'?`已结算普通采集累计达到 ${target} 次。`:id==='banker'?`已交付口粮累计达到 ${target} 份。`:`累计胜利达到 ${target} 次。`;
    return {id,name,description,progress,target,unlocked,claimed:(meta.claimed??[]).includes(id),food:C(`achievements.${id}.food`),genes:C(`achievements.${id}.genes`)};
  });
}
function claim(meta,id) {
  const achievement=achievements(meta).find(item=>item.id===id);
  if (!achievement || !achievement.unlocked || achievement.claimed) return false;
  ensureStats(meta);
  meta.food=Math.min(MAX_CURRENCY,meta.food+achievement.food);
  meta.genes=Math.min(MAX_COUNT,meta.genes+achievement.genes);
  meta.claimed.push(id);
  return true;
}
export const Rogue=Object.freeze({
  get UPGRADES() { return upgrades(); },get TRAITS() { return traits(); },get PERKS() { return perks(); },
  get targets() { return targets(); },
  freshMeta,validateMeta,initRun,target,ready,stats,collect,draft,select,deliver,hit,tick,settle,buy,achievements,claim,
});

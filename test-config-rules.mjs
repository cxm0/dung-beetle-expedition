import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Config as C } from './config.js';
import { Rogue as R } from './rogue.js';
let groups=0, assertions=0;
const eq=(actual,expected)=>{ assert.deepStrictEqual(actual,expected);assertions++; };
const ok=value=>{ assert.ok(value);assertions++; };
const throws=fn=>{ assert.throws(fn,Error);assertions++; };
const near=(actual,expected)=>ok(Math.abs(actual-expected)<1e-9);
const clone=value=>structuredClone(value);
const change=values=>C.apply({...C.export(),values:{...C.export().values,...values}});
const setup=(meta=R.freshMeta(),trait='forager',difficulty=0)=>({meta,s:R.initRun({},meta,123,trait,difficulty)});
const choose=(s,id)=>eq(R.select(s,id,[id]),true);
function test(name,fn) {
  C.reset();
  fn();
  groups++;
  console.log(`通过 ${String(groups).padStart(2,'0')}：${name}`);
}

// 为每一条业务字段固定默认值；实现与测试不共享默认值生成逻辑。
const expectedGroups={
  run:{baseTime:210,timeCap:300,stageBonus:25,baseHp:4,minHp:2,startMass:1,massCap:24,rerolls:1,draftEvery:12,hardLimit:0},
  collect:{goldAroma:1,goldFood:3,normalFood:1,score:20,comboStep:3,comboMax:5,goldScore:60},
  deliver:{foodPerKg:2,scorePerKg:100,heal:1,invincible:3},
  hit:{hp:1,minMass:1.8,massRatio:.25,aroma:1,time:4,invincible:2.2},
  settle:{failKeep:.2,retreatKeep:.6,winFood:40,difficultyFood:10,winGenes:3,difficultyGenes:1,offspring:2,timeScore:8},
  meta:{initialFood:18},gene:{max:2,cost:3,aromaPerLevel:1},difficulty:{max:10},
  'stage.0':{mass:6,aroma:0,count:2},'stage.1':{mass:10,aroma:3,count:1},'stage.2':{mass:8,aroma:1,count:2},
  'trait.forager':{unlock:0,speed:1,growth:1.12,hp:0},'trait.runner':{unlock:2,speed:1.12,growth:1,hp:-1},'trait.guardian':{unlock:4,speed:.92,growth:1,hp:2},
  perk:{armorCap:.7},instant:{heal:2,clock:20,cash:8},
  world:{normalCount:132,goldCount:20,starterMass:.9,normalMin:.6,normalMax:1.05,outerBonus:1.6,riskRadius:22,normalRespawn:23,goldRespawn:26,pickupPadding:.32},
  move:{walk:5.4,dash:10,drain:28,regen:17,water:.48,rain:.86,drought:1.35,weatherPeriod:32,jump:7},
  enemy:{baseCount:3,perStage:1,chase:2.65,stageSpeed:.25,patrol:1.6,difficultySpeed:.12},
  bird:{first:11,baseInterval:13,minInterval:4,stageReduction:1.8,difficultyReduction:.35,riskReduction:4,warning:1.6,radius:2.8},
  relic:{time:12,food:12},estimate:{pickupsPerMinute:18,distancePerDelivery:30,travelSpeed:4,successRate:.6,foodPerRun:100,sessionOverhead:40},
};
for (const [id,value] of Object.entries({shell:1,seed:.5,legs:.05,insurance:.15})) expectedGroups[`upgrade.${id}`]={max:3,cost1:12,cost2:24,cost3:40,costGrowth:1.6,value};
for (const [id,value] of Object.entries({swift:.1,growth:.2,magnet:.55,endurance:.15,recovery:.25,armor:.3,insurance:.1,aroma:1,jump:1.5,thorns:.05,bank:.25,vitality:1})) expectedGroups[`perk.${id}`]={max:2,value};
for (const [id,target,food,genes] of [['first_win',1,12,0],['family',10,24,1],['veteran',10,40,2],['collector',200,20,0],['banker',1000,40,1],['swift',120,30,1]]) expectedGroups[`achievements.${id}`]={target,food,genes,enabled:1};

test('完整字段契约、legacy 默认及估算隔离说明',()=>{
  for (const [prefix,values] of Object.entries(expectedGroups)) for (const [key,value] of Object.entries(values)) eq(C.get(`${prefix}.${key}`),value);
  eq(C.legacy,C.defaults);
  eq(C.validate(C.export()),C.export());
  eq(new Set(C.fields.map(item=>item.key)).size,C.fields.length);
  for (const item of C.fields) {
    eq(Object.keys(item).sort(),['key','group','label','unit','min','max','step','integer','default','help','impact'].sort());
    eq(C.defaults[item.key],item.default);
    ok(item.label && item.help && item.impact);
    ok(item.help.includes(item.key.startsWith('achievements.')?'PLACEHOLDER':'legacy'));
  }
  ok(C.describe().time.includes('倒计时'));
  eq(C.get('不存在'),undefined);
  eq(C.get('__proto__'),undefined);
});
test('格式、未知字段、缺字段、类型与整数边界严格拒绝',()=>{
  for (const value of [null,[],{},'',5,new Date()]) throws(()=>C.validate(value));
  for (const patch of [{format:'bad'},{version:2},{version:'1'},{extra:1}]) throws(()=>C.validate({...C.export(),...patch}));
  for (const key of ['format','version','values']) { const input=C.export();delete input[key];throws(()=>C.validate(input)); }
  for (const item of C.fields) {
    const missing=C.export();delete missing.values[item.key];throws(()=>C.validate(missing));
    for (const value of [NaN,Infinity,-Infinity,'1',null,true,undefined,item.min-1,item.max+1]) throws(()=>change({[item.key]:value}));
    if (item.integer) throws(()=>change({[item.key]:item.min+0.5}));
  }
  throws(()=>change({unknown:1}));
  const input=C.export();input.values[Symbol('隐藏')]=1;throws(()=>C.validate(input));
  const proto=C.export();Object.setPrototypeOf(proto.values,{injected:1});throws(()=>C.validate(proto));
  const polluted=C.export();Object.defineProperty(polluted.values,'__proto__',{value:1,enumerable:true});throws(()=>C.validate(polluted));
  let calls=0;
  for (const where of ['envelope','values']) {
    const getter=C.export();Object.defineProperty(where==='envelope'?getter:getter.values,where==='envelope'?'values':'run.baseTime',{get(){calls++;return 1;}});throws(()=>C.validate(getter));
  }
  eq(calls,0);
});
test('跨字段约束与宽松合法边界',()=>{
  for (const patch of [
    {'run.baseTime':301},{'run.minHp':5},{'run.massCap':9},{'run.startMass':23},
    {'stage.0.mass':25},{'stage.1.mass':25},{'stage.2.mass':25},
    {'world.normalMin':2},{'bird.minInterval':14},{'move.walk':11},
    {'perk.endurance.max':5,'perk.endurance.value':.2},{'collect.goldAroma':0},
    {'trait.forager.unlock':1},{'enemy.perStage':1.1},{'upgrade.shell.max':20,'upgrade.shell.costGrowth':5,'upgrade.shell.cost3':1000000},
  ]) throws(()=>change(patch));
  change({'run.baseTime':300,'run.minHp':4,'world.normalMin':1.05,'bird.minInterval':13,'move.walk':10,'perk.endurance.max':5,'perk.endurance.value':.18});
  near(C.get('perk.endurance.max')*C.get('perk.endurance.value'),.9);
  change({'collect.goldAroma':0,'stage.1.aroma':0,'stage.2.aroma':0});
  eq(C.get('collect.goldAroma'),0);
});
test('apply 原子性、快照隔离、冻结与稳定内容 hash',()=>{
  const before=C.export(),revision=C.revision;
  eq(typeof revision,'string');ok(revision.length<=16);
  throws(()=>change({'run.baseTime':999}));eq(C.export(),before);eq(C.revision,revision);
  const validated=C.validate({...before,values:{...before.values,'run.baseTime':200}});
  eq(C.get('run.baseTime'),210);
  const result=C.apply(validated);validated.values['run.baseTime']=12;result.values['run.baseTime']=13;
  eq(C.get('run.baseTime'),200);ok(C.revision!==revision);
  const exported=C.export();exported.values['run.baseTime']=15;eq(C.get('run.baseTime'),200);
  const reordered={...C.export(),values:Object.fromEntries(Object.entries(C.export().values).reverse())};
  const changedRevision=C.revision;C.apply(reordered);eq(C.revision,changedRevision);
  throws(()=>{C.defaults['run.baseTime']=12;});throws(()=>{C.fields[0].default=12;});throws(()=>{C.fields.push({});});throws(()=>{C.revision='bad';});
  C.reset();eq(C.export(),before);eq(C.revision,revision);
});

test('legacy 局内基础规则、固定抽卡序列与完整胜利',()=>{
  const {s,meta}=setup();
  eq([meta.food,s.time,s.mass,s.hp,s.stamina,s.rerolls],[18,210,1,4,100,1]);
  const seeded=R.initRun({},R.freshMeta(),0);eq(R.draft(seeded),['magnet','recovery','bank']);
  near(R.collect(s,2).massGain,2.24);eq([s.score,s.pocket,s.collected],[20,1,1]);
  const score=s.score;eq(R.collect(s,undefined,true),{massGain:0,aromaGain:1,levelUp:false});eq(s.score,score);
  for (let i=2;i<=12;i++) eq(R.collect(s,1).levelUp,i===12);
  near(s.mass,15.56);
  const run=setup();
  for (const [index,banked] of [15,15,23,19,19].entries()) {
    Object.assign(run.s,{mass:R.target(run.s).mass,aroma:R.target(run.s).aroma,pocket:3,time:290,hp:1});
    const result=R.deliver(run.s,run.meta);eq(result.banked,banked);eq(result.won,index===4);
  }
  eq([run.s.score,run.s.banked,run.meta.food,run.meta.stats.banked],[3800,91,109,91]);
  R.tick(run.s,20.25);
  eq(R.settle(run.s,run.meta,'win').recovered,40);
  eq([run.meta.food,run.meta.genes,run.meta.offspring,run.meta.wins,run.meta.stats.bestWinSeconds],[149,3,2,1,20.25]);
  for (const [level,retained] of [[0,20],[1,35],[2,50],[3,65]]) {
    const meta=R.freshMeta();meta.upgrades.insurance=level;const {s}=setup(meta);s.pocket=100;eq(R.settle(s,meta,'fail').recovered,retained);
  }
});
test('初始化、采集、阶段目标和交付配置立即生效',()=>{
  change({'meta.initialFood':50,'run.baseTime':180,'run.timeCap':200,'run.stageBonus':7,'run.baseHp':6,'run.minHp':3,'run.startMass':2,'run.rerolls':4,'run.draftEvery':2,'run.staminaCap':150,'run.draftChoices':2,'collect.goldAroma':2,'collect.goldFood':5,'collect.normalFood':4,'collect.score':30,'collect.comboStep':1,'collect.comboMax':2,'stage.0.mass':3,'stage.0.aroma':2,'stage.0.count':1,'deliver.foodPerKg':3,'deliver.scorePerKg':10,'deliver.heal':2,'deliver.invincible':5});
  const {s,meta}=setup();eq([meta.food,s.time,s.mass,s.hp,s.rerolls,s.stamina],[50,180,2,6,4,150]);
  eq(R.draft(s).length,2);
  R.collect(s,1);eq(R.collect(s,1).levelUp,true);eq(s.score,90);eq(s.pocket,8);
  eq(R.collect(s,0,true).aromaGain,2);eq(s.pocket,13);
  eq(R.target(s).mass,3);ok(R.target(s).description.includes('至少 3'));
  s.mass=3;s.hp=1;
  const result=R.deliver(s,meta);eq(result.banked,22);eq(result.stageChange,true);
  eq([s.time,s.hp,s.invincible,s.score,s.mass,meta.stats.banked],[187,3,5,120,2,22]);
  change({'run.massCap':10});R.collect(s,100);eq(s.mass,10);
});
test('受击、即时卡和三种结算配置生效',()=>{
  change({'hit.hp':2,'hit.minMass':3,'hit.massRatio':.4,'hit.aroma':2,'hit.time':9,'hit.invincible':4,'instant.heal':3,'instant.clock':35,'instant.cash':11,'settle.failKeep':.4,'settle.retreatKeep':.8,'settle.winFood':70,'settle.difficultyFood':20,'settle.winGenes':5,'settle.difficultyGenes':2,'settle.offspring':3,'settle.timeScore':4});
  const {s}=setup();Object.assign(s,{mass:20,aroma:5,time:100});eq(R.hit(s).loss,8);eq([s.hp,s.aroma,s.time,s.invincible],[2,3,91,4]);
  choose(s,'heal');eq(s.hp,4);choose(s,'clock');eq(s.time,126);choose(s,'cash');eq(s.pocket,11);
  for (const [outcome,recovered] of [['fail',40],['retreat',80]]) { const run=setup();run.s.pocket=100;eq(R.settle(run.s,run.meta,outcome).recovered,recovered); }
  const meta=R.freshMeta();meta.difficulty=2;const run=setup(meta,'forager',2);Object.assign(run.s,{pocket:9,time:10,elapsed:70.125});
  const result=R.settle(run.s,meta,'win');eq([result.recovered,result.genes,result.offspring,result.score],[119,9,3,40]);eq(meta.stats.bestWinSeconds,70.125);
});
test('永久升级 1..20 级价格、动态描述和旧等级保留',()=>{
  change({'upgrade.shell.max':5,'upgrade.shell.cost1':2,'upgrade.shell.cost2':3,'upgrade.shell.cost3':5,'upgrade.shell.costGrowth':1.5,'upgrade.shell.value':2,'upgrade.seed.value':1,'upgrade.legs.value':.2,'upgrade.insurance.value':.2});
  const upgrade=R.UPGRADES.find(item=>item.id==='shell');eq(upgrade.cost,[2,3,5,8,12]);ok(upgrade.description.includes('+2'));
  const meta=R.freshMeta();meta.food=10000;
  for (let i=0;i<5;i++) eq(R.buy(meta,'shell'),true);
  eq(R.buy(meta,'shell'),false);eq(setup(meta).s.hp,14);
  meta.upgrades.seed=3;meta.upgrades.legs=3;meta.upgrades.insurance=3;
  const before=clone(meta);change({'upgrade.shell.max':1,'upgrade.seed.max':1,'upgrade.legs.max':1,'upgrade.insurance.max':1});
  eq(R.validateMeta(meta),before);const {s}=setup(meta);eq(s.hp,6);eq(s.mass,2);near(R.stats(s).speed,1.2);near(R.stats(s).insurance,.4);eq(meta,before);
  change({'upgrade.shell.max':20});meta.upgrades.shell=20;eq(R.validateMeta(meta).upgrades.shell,20);eq(setup(meta).s.hp,44);
  meta.upgrades.shell=21;throws(()=>R.validateMeta(meta));
  eq(R.buy(R.freshMeta(),'__proto__'),false);
});
test('所有常驻卡数值、等级上限及描述实时生成',()=>{
  const checks={swift:(a)=>near(a.speed,1.4),growth:(a)=>near(a.growth,1.12*1.6),magnet:a=>near(a.magnet,.4),endurance:a=>near(a.drain,.6),recovery:a=>near(a.regen,1.4),armor:a=>near(a.armor,.4),insurance:a=>near(a.insurance,.6),aroma:a=>eq(a.aromaBonus,4),jump:a=>near(a.jump,.4),thorns:a=>{eq(a.thorns,true);near(a.armor,.4);},bank:a=>near(a.bankBonus,1.4),vitality:a=>eq(a.maxHp,8)};
  for (const [id,check] of Object.entries(checks)) {
    C.reset();const value=['aroma','vitality'].includes(id)?2:id==='growth'?.3:.2;
    const previous=R.PERKS.find(item=>item.id===id).description;
    change({[`perk.${id}.value`]:value,[`perk.${id}.max`]:4});
    ok(R.PERKS.find(item=>item.id===id).description!==previous);
    const {s}=setup();choose(s,id);choose(s,id);check(R.stats(s));choose(s,id);choose(s,id);eq(R.select(s,id,[id]),false);ok(!R.draft(s).includes(id));
    change({[`perk.${id}.max`]:1});eq(s.perks[id],4);
  }
  C.reset();change({'perk.armorCap':.2});const {s}=setup();choose(s,'armor');near(R.stats(s).armor,.2);
  change({'instant.clock':33,'run.timeCap':333});ok(R.PERKS.find(item=>item.id==='clock').description.includes('33'));
});
test('特质阈值变化不破坏存档，初始化安全回退；难度保留并封顶',()=>{
  const meta=R.freshMeta();meta.trait='runner';meta.offspring=2;meta.difficulty=50;
  change({'trait.runner.unlock':8,'trait.runner.speed':1.5,'trait.runner.growth':1.4,'trait.runner.hp':3,'difficulty.max':3});
  eq(R.validateMeta(meta).trait,'runner');eq(R.validateMeta(meta).difficulty,50);
  const fallback=setup(meta,'runner',50).s;eq(fallback.trait,'forager');eq(fallback.difficulty,3);
  meta.offspring=8;const runner=setup(meta,'runner').s;eq(runner.hp,7);near(R.stats(runner).speed,1.5);near(R.stats(runner).growth,1.4);
  eq(R.TRAITS.find(item=>item.id==='runner').requireOffspring,8);ok(R.TRAITS.find(item=>item.id==='runner').description.includes('1.5'));
  throws(()=>setup(meta,'unknown'));throws(()=>setup(meta,'runner',51));
  const fresh=R.freshMeta();throws(()=>setup(fresh,'forager',1));
});
test('hardLimit 使用累计实际时长，续时不能绕过且结算原因优先',()=>{
  change({'run.hardLimit':10});const {s,meta}=setup();
  R.tick(s,6);choose(s,'clock');R.tick(s,3.5);eq(s.hardTimedOut,false);ok(s.time>210);
  R.tick(s,.5);eq([s.elapsed,s.time,s.hardTimedOut],[10,0,true]);
  eq(R.select(s,'clock',['clock']),false);eq(R.deliver(s,meta).ok,false);eq(R.draft(s),[]);
  const result=R.settle(s,meta,'win');eq(result.outcome,'fail');eq(result.reasonLabel,'累计时长上限');eq(meta.wins,0);eq(meta.stats.bestWinSeconds,null);
  const before=clone({s,meta});eq(R.settle(s,meta,'retreat'),result);R.tick(s,100);eq({s,meta},before);
  C.reset();const unlimited=setup();R.tick(unlimited.s,500);eq(unlimited.s.hardTimedOut,false);eq(unlimited.s.elapsed,500);
  change({'run.hardLimit':2});const over=setup();R.tick(over.s,2.25);eq(over.s.elapsed,2.25);eq(over.s.time,0);
});
test('采集结算一次、交付立即统计、三种结果均幂等',()=>{
  for (const outcome of ['win','fail','retreat']) {
    const {s,meta}=setup();for(let i=0;i<4;i++)R.collect(s,1);R.collect(s,0,true);
    eq(meta.stats.collected,0);s.mass=6;R.deliver(s,meta);eq(meta.stats.banked,19);
    R.tick(s,10.125);const result=R.settle(s,meta,outcome);eq(meta.stats.collected,4);eq(meta.stats.banked,19);
    const before=clone(meta);for(const again of ['win','fail','retreat'])eq(R.settle(s,meta,again),result);eq(meta,before);
    eq(meta.stats.bestWinSeconds,outcome==='win'?10.125:null);eq(R.validateMeta(meta),meta);
  }
});
test('六项成就条件、配置奖励、禁用与领取幂等防刷',()=>{
  const meta=R.freshMeta();eq(R.achievements(meta).length,6);eq(R.claim(meta,'first_win'),false);eq(R.claim(meta,'unknown'),false);eq(meta.claimed,[]);
  Object.assign(meta,{wins:10,offspring:10});Object.assign(meta.stats,{collected:200,banked:1000,bestWinSeconds:120});
  for(const item of R.achievements(meta)) {eq(item.unlocked,true);eq(item.claimed,false);}
  const before=meta.food;for(const id of ['first_win','family','veteran','collector','banker','swift'])eq(R.claim(meta,id),true);
  eq(meta.food-before,166);eq(meta.genes,5);eq(meta.claimed.length,6);eq(R.validateMeta(meta),meta);
  change({'achievements.first_win.target':20,'achievements.first_win.food':999});eq(R.claim(meta,'first_win'),false);
  change({'achievements.first_win.target':1});eq(R.claim(meta,'first_win'),false);eq(meta.food-before,166);
  const second=R.freshMeta();second.wins=1;
  change({'achievements.first_win.food':77,'achievements.first_win.genes':4,'achievements.first_win.enabled':0});eq(R.claim(second,'first_win'),false);
  change({'achievements.first_win.enabled':1});eq(R.claim(second,'first_win'),true);eq([second.food,second.genes],[95,4]);
  second.stats.bestWinSeconds=121;eq(R.claim(second,'swift'),false);change({'achievements.swift.target':122});eq(R.claim(second,'swift'),true);
  const noWin=R.freshMeta();noWin.stats.bestWinSeconds=0;eq(R.claim(noWin,'swift'),false);
});
test('旧二代存档迁移、严格统计字段、最佳实际小数秒',()=>{
  const legacy={version:2,food:18,genes:0,offspring:10,wins:3,runs:4,best:100,upgrades:{shell:4,seed:0,legs:0,insurance:0},trait:'guardian',difficulty:20,activeRun:null};
  const normalized=R.validateMeta(legacy);eq(normalized.stats,{collected:0,banked:0,bestWinSeconds:null});eq(normalized.claimed,[]);eq(Object.hasOwn(legacy,'stats'),false);
  eq(R.achievements(legacy).find(item=>item.id==='family').unlocked,true);eq(R.achievements(legacy).find(item=>item.id==='swift').unlocked,false);
  const run=setup(legacy);R.collect(run.s,1);R.tick(run.s,1.23456789);R.settle(run.s,legacy,'win');eq(legacy.stats.bestWinSeconds,1.23456789);eq(legacy.stats.collected,1);eq(R.validateMeta(legacy),legacy);
  for(const value of [-1,NaN,Infinity,'1',false,1e9+1]) {const meta=clone(legacy);meta.stats.bestWinSeconds=value;throws(()=>R.validateMeta(meta));}
  for(const key of ['collected','banked']) for(const value of [-1,.5,NaN,Infinity,'2',1e12+1]) {const meta=clone(legacy);meta.stats[key]=value;throws(()=>R.validateMeta(meta));}
  for(const key of ['collected','banked','bestWinSeconds']) {const meta=clone(legacy);delete meta.stats[key];throws(()=>R.validateMeta(meta));}
  for(const claimed of [['unknown'],['family','family'],[1],null,new Array(1)])throws(()=>R.validateMeta({...legacy,claimed}));
  throws(()=>R.validateMeta({...legacy,stats:{...legacy.stats,extra:1}}));throws(()=>R.validateMeta({...legacy,cheat:1}));
  throws(()=>R.validateMeta({...R.freshMeta(),stats:{collected:0,banked:0,bestWinSeconds:1}}));
  const detached=R.validateMeta(legacy);detached.stats.collected=999;detached.claimed.push('family');eq(legacy.stats.collected,1);eq(legacy.claimed,[]);
});
test('估算与主层字段独立可读，不改变纯规则结果',()=>{
  const before=setup();const beforeStats=R.stats(before.s);
  change({'estimate.pickupsPerMinute':22,'estimate.distancePerDelivery':40,'estimate.travelSpeed':5,'estimate.successRate':.8,'estimate.foodPerRun':160,'estimate.sessionOverhead':80,'world.normalCount':200,'world.goldCount':40,'move.walk':7,'move.dash':12,'enemy.baseCount':2,'enemy.perStage':0,'bird.first':20,'relic.time':30,'gene.max':5,'gene.cost':6,'gene.aromaPerLevel':2,'collect.goldScore':90});
  const after=setup();eq(after,before);eq(R.stats(after.s),beforeStats);eq(C.get('world.normalCount'),200);eq(C.get('collect.goldScore'),90);
});

// 显式持久化入口测试：配置与规则导入绝不触发读取，任何操作绝不写入。
const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
let reads=0,writes=0,stored=null;
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(key){eq(key,'dung-balance-v1');reads++;return stored;},setItem(){writes++;throw new Error('不允许写入');}}});
try {
  const freshModule=await import(`./config.js?config-rules-no-auto-load`);
  test('无隐式读取、load 校验应用、错误保留当前配置且不写存储',()=>{
    eq(reads,0);freshModule.Config.get('run.baseTime');freshModule.Config.reset();eq(reads,0);
    const original=C.export();eq(C.load(),original);eq(reads,1);
    stored=JSON.stringify({...original,values:{...original.values,'run.baseTime':180}});eq(C.load().values['run.baseTime'],180);eq(C.error,'');
    const stable=C.export(),revision=C.revision;
    for(const value of ['bad','null','{}',JSON.stringify({...original,values:{...original.values,extra:2}})]){stored=value;eq(C.load(),null);ok(C.error.includes('失败'));eq(C.export(),stable);eq(C.revision,revision);}
    globalThis.localStorage.getItem=()=>{throw new Error('存储被禁用');};eq(C.load(),null);ok(C.error.includes('存储被禁用'));
    C.reset();eq(C.error,'');eq(writes,0);
  });
} finally {
  if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;
  C.reset();
}
const source=await readFile(new URL('./rogue.js',import.meta.url),'utf8');
test('规则模块纯边界与动态冻结集合',()=>{
  ok(!/\b(?:document|window|localStorage|sessionStorage|fetch|Date)\b|Math\.random/.test(source));
  ok(Object.isFrozen(R));ok(Object.isFrozen(R.UPGRADES));ok(Object.isFrozen(R.TRAITS));ok(Object.isFrozen(R.PERKS));
  const first=R.UPGRADES;change({'upgrade.shell.value':3});ok(R.UPGRADES!==first);ok(R.UPGRADES[0].description.includes('+3'));ok(first[0].description.includes('+1'));
});
C.reset();
console.log(`\n配置规则测试通过：${groups} 组，${assertions} 条断言，0 失败。`);

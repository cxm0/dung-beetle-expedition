import { Rogue } from './rogue.js';
import { Config } from './config.js';

// 配置与玩家进度使用独立存储；坏存档保持只读，直到玩家主动恢复。
export function createExpedition({state:s,ui,setMode,toast,sfx,updateHUD,burst,restart}) {
 const $=id=>document.getElementById(id), C=key=>Config.get(key), KEY='dung-life-expedition-v2', CONFIG_KEY='dung-balance-v1';
 const percent=value=>Number((value*100).toFixed(8)), number=value=>Number(value.toFixed(8));
 const currency=value=>Math.min(1e12,Math.max(0,Math.round(value)));
 let meta=Rogue.freshMeta(),geneLevel=0,selectedDifficulty=0,logs=[],journal=null;
 let available=true,storageMessage='',offered=[],campReturn='home',pendingDraft=0;
 let configBusy=false,configMessage=Config.error||'当前配置已就绪；导入与恢复默认只在局外生效。',configError=!!Config.error;
 const geneAroma=()=>Math.min(geneLevel,C('gene.max'))*C('gene.aromaPerLevel');
 const runDifficulty=()=>Math.min(selectedDifficulty,meta.difficulty,C('difficulty.max'));
 function validEnvelope(raw){
  if(!raw||raw.format!=='dung-life-2')throw Error('不是生命远征存档');
  const m=Rogue.validateMeta(raw.meta);
  if(!Number.isInteger(raw.geneLevel)||raw.geneLevel<0||raw.geneLevel>20)throw Error('传承等级无效');
  if(!Number.isInteger(raw.selectedDifficulty)||raw.selectedDifficulty<0||raw.selectedDifficulty>m.difficulty)throw Error('难度无效');
  let j=null;
  if(raw.journal!==null){const v=raw.journal;if(!v||!Number.isSafeInteger(v.pocket)||v.pocket<0||v.pocket>1e12||!Number.isSafeInteger(v.score)||v.score<0||v.score>1e12||typeof v.insurance!=='number'||!Number.isFinite(v.insurance)||v.insurance<0||v.insurance>1)throw Error('远征记录无效');if(v.collected!==undefined&&(!Number.isSafeInteger(v.collected)||v.collected<0||v.collected>1e9))throw Error('采集记录无效');j={pocket:v.pocket,score:v.score,insurance:v.insurance,collected:v.collected??0};}
  if(Boolean(m.activeRun)!==Boolean(j))throw Error('远征状态不一致');
  return {meta:m,geneLevel:raw.geneLevel,selectedDifficulty:raw.selectedDifficulty,journal:j,logs:Array.isArray(raw.logs)?raw.logs.filter(x=>typeof x==='string'&&x.length<300).slice(0,6):[]};
 }
 function envelope(){return {format:'dung-life-2',meta,geneLevel,selectedDifficulty,journal,logs};}
 function addLog(text){logs.unshift(text);logs=logs.slice(0,6);}
 function recoverInterrupted(){if(meta.activeRun){const kept=Math.floor((journal?.pocket??0)*(journal?.insurance??C('settle.failKeep')));meta.food=currency(meta.food+kept);meta.runs=Math.min(1e9,meta.runs+1);meta.stats.collected=Math.min(1e9,meta.stats.collected+(journal?.collected??0));meta.best=Math.max(meta.best,journal?.score??0);addLog(`上次远征中断：按失败结算，背包回收 ${kept} 粮；已入库 ${meta.activeRun.banked} 粮不受影响。`);meta.activeRun=null;journal=null;return true;}return false;}
 try{const text=localStorage.getItem(KEY);if(text){const v=validEnvelope(JSON.parse(text));({meta,geneLevel,selectedDifficulty,journal,logs}=v);recoverInterrupted();}}catch(e){storageMessage='无法读取旧存档：已启用临时进度；原记录未覆盖。请导入有效备份。';available=false;}
 function save(){
  if(!available)return false;
  try{localStorage.setItem(KEY,JSON.stringify(envelope()));storageMessage='已保存在当前浏览器。刷新或关闭未结束的远征，按失败结算。';return true;}
  catch{available=false;storageMessage='浏览器禁止或无法写入存档；当前仅临时有效，请立即导出备份。';toast(storageMessage,6000);return false;}
 }
 function checkpoint(){if(meta.activeRun&&!s.settled){meta.activeRun.banked=currency(s.banked);journal={pocket:currency(s.pocket),score:currency(s.score),insurance:Rogue.stats(s).insurance,collected:s.collected};}save();}
 function initIdle(){
  if(meta.activeRun)return;
  Rogue.initRun(s,meta,1,meta.trait,runDifficulty());s.settled=true;s.aroma=geneAroma();
 }
 function refreshIdle(){
  const mode=s.mode==='camp'?campReturn:s.mode;
  if(!meta.activeRun&&['home','ended'].includes(mode))initIdle();
  renderMeta();updateHUD();update();
 }
 initIdle();
 if(available)save();
 function renderConfig(){
  $('configStatus').textContent=`revision ${Config.revision} · ${meta.activeRun?'远征中：禁止导入或恢复默认。 ':''}${configMessage}`;
  $('configStatus').dataset.status=configError?'error':'success';
  $('trialSeed').disabled=!!meta.activeRun;
  $('configImportBtn').disabled=$('configResetBtn').disabled=$('configImportInput').disabled=!!meta.activeRun||configBusy;
  $('configImportBtn').textContent=configBusy?'正在读取配置…':'导入配置 JSON';
 }
 function configFeedback(message,error=false){configMessage=message;configError=error;renderConfig();toast(message,error?6000:3500);}
 function requireIdle(){if(meta.activeRun)throw Error('远征尚未结束，不能修改配置。请先结算或撤离。');}
 function applyConfig(input){
  let next;
  try{
   requireIdle();next=Config.validate(input);requireIdle();
   // 必须先成功落盘，再变更规则内存；失败不重置玩家进度或当前局。
   localStorage.setItem(CONFIG_KEY,JSON.stringify(next));
  }catch(err){const error=err.message||String(err);configFeedback(`配置未改动：${error}`,true);return {ok:false,error};}
  Config.apply(next);
  configMessage='配置已保存并生效，玩家进度保留，无需刷新页面。';configError=false;
  refreshIdle();window.dispatchEvent(new Event('balancechange'));
  configFeedback(configMessage);return {ok:true,revision:Config.revision};
 }
 function resetConfig(){return applyConfig({format:'dung-balance-1',version:1,values:Object.fromEntries(Config.fields.map(field=>[field.key,field.default]))});}
 function renderRules(){
  const stages=Rogue.targets;
  $('homeBaseTime').textContent=C('run.baseTime');$('homeBaseHp').textContent=C('run.baseHp');
  $('homeStages').innerHTML=stages.map((g,i)=>`<li><span class="step-number">0${i+1}</span><div><strong>${g.name}</strong><span>${g.description}</span></div></li>`).join('');
  const draftRule=`开局、每采集 ${C('run.draftEvery')} 份普通养料及非最终阶段结束时，从 ${C('run.draftChoices')} 项进化中选一项；选择期间暂停时间。每局初始重掷 ${C('run.rerolls')} 次。`;
  $('homeDraftRule').textContent=draftRule;$('draftHint').textContent=draftRule;
  $('draftCards').setAttribute('aria-label',`${C('run.draftChoices')} 选一进化`);
  $('helpIntro').textContent=`基础倒计时 ${C('run.baseTime')} 秒，基础生命 ${C('run.baseHp')} 点。${C('run.hardLimit')>0?`累计活跃时长上限 ${C('run.hardLimit')} 秒；续时不能延长此上限。`:'不限制累计活跃时长；倒计时耗尽仍会失败。'}`;
  const rules=[
   ['三阶段，延续生命',stages.map(g=>`${g.name}：${g.description}`).join(' ')+' 达标后在巢穴按 E 或点击交付，不是路过即交付。'],
   ['采集与进化',`普通养料增加球质量并提供 ${C('collect.normalFood')} 粮；金色孢子基础增加 ${C('collect.goldAroma')} 香气、${C('collect.goldFood')} 粮并恢复体力。${draftRule}`],
   ['受击与交付',`受击扣 ${C('hit.hp')} 生命、${C('hit.time')} 秒及 ${C('hit.aroma')} 香气；基础球损失为质量的 ${percent(C('hit.massRatio'))}% 与 ${C('hit.minMass')} kg 中较大者，受护球减免和质量下限 ${C('hit.massFloor')} kg 约束。受击无敌 ${C('hit.invincible')} 秒。交付最多回复 ${C('deliver.heal')} 生命并无敌 ${C('deliver.invincible')} 秒。冲刺默认不免伤，荆棘进化例外。`],
   ['天气、鸟袭与遗物',`留意天气和地面鸟袭红圈，及时移出范围。水洼速度 ×${C('move.water')}，蘑菇帮助弹跳。首次鸟袭计时 ${C('bird.first')} 秒；遗物可交易一次：消耗 ${C('relic.time')} 秒、获得 ${C('relic.food')} 背包粮；若仍有时间，再选择一次进化。`],
   ['收获入库，再决定是否冒险',`交付入库 = 背包粮食 + 向下取整（球质量 × ${C('deliver.foodPerKg')} × 丰收倍率）。阶段完成增加 ${C('run.stageBonus')} 秒，倒计时最高 ${C('run.timeCap')} 秒。失败基础保留 ${percent(C('settle.failKeep'))}% 背包；撤离至少保留 ${percent(C('settle.retreatKeep'))}% 且不低于失败保留率。胜利带回全部背包，另获 ${C('settle.winFood')} + 难度 × ${C('settle.difficultyFood')} 粮、${C('settle.winGenes')} + 难度 × ${C('settle.difficultyGenes')} 基因和 ${C('settle.offspring')} 后代。已入库粮食不受失败影响。`],
   ['局外成长与独立配置',`每级传承花费 ${C('gene.cost')} 基因，初始香气 +${C('gene.aromaPerLevel')}，当前上限 ${C('gene.max')} 级。新档初始赠粮 ${C('meta.initialFood')}，不补发给已有存档。旧升级已购等级保留，效果按新上限计算；难度开局按当前上限 ${C('difficulty.max')} 截断。成就只能局外领取，降低门槛不会重复奖励。配置与玩家存档独立、按浏览器及站点隔离，不跨设备同步；导入配置不会恢复玩家进度。`],
  ];
  $('helpDynamic').innerHTML=rules.map(([title,text],i)=>`<li><span class="step-number">0${i+1}</span><div><h3>${title}</h3><p>${text}</p></div></li>`).join('');
  $('retreatKeepLabel').textContent=`至少带回 ${percent(C('settle.retreatKeep'))}% 背包`;
  $('abandonDescription').textContent=`已入库粮食保留。本局背包按失败保留率结算：基础 ${percent(C('settle.failKeep'))}%，升级与进化可提高。这不是安全撤离，不享受至少 ${percent(C('settle.retreatKeep'))}% 的撤离保障。`;
 }
 function renderMeta(){
  $('metaSummary').textContent=`粮食 ${meta.food} · 基因 ${meta.genes} · 后代 ${meta.offspring}`;
  $('campStats').innerHTML=[['粮食',meta.food],['基因',meta.genes],['后代',meta.offspring],['最高分',meta.best]].map(([n,v])=>`<div><span>${n}</span><strong>${v}</strong></div>`).join('');
  const locked=!!meta.activeRun;
  $('upgradeGrid').innerHTML=Rogue.UPGRADES.map(u=>{const level=meta.upgrades[u.id],cost=u.cost[level];return `<button class="upgrade-card" data-upgrade="${u.id}" ${locked||level>=u.max||meta.food<cost?'disabled':''}><span class="card-topline">巢穴建设 <b>${level}/${u.max}</b></span><h3>${u.name}</h3><p>${u.description}${level>u.max?` 已购 ${level} 级保留，当前按 ${u.max} 级生效。`:''}</p><strong>${level>=u.max?'已达当前上限':cost+' 粮食 · 升级'}</strong></button>`;}).join('');
  $('traitGrid').innerHTML=Rogue.TRAITS.map(t=>`<button class="trait-card ${meta.trait===t.id?'selected':''}" data-trait="${t.id}" ${locked||meta.offspring<t.requireOffspring?'disabled':''}><span class="card-topline">${meta.trait===t.id?'已装备':meta.offspring<t.requireOffspring?'需要 '+t.requireOffspring+' 后代':'可选择'}</span><h3>${t.name}</h3><p>${t.description}${meta.trait===t.id&&meta.offspring<t.requireOffspring?' 当前不满足门槛，开局使用采集者。':''}</p></button>`).join('');
  $('geneLevelLabel').textContent=`${geneLevel} / ${C('gene.max')} 级`;$('geneUpgradeBtn').disabled=locked||geneLevel>=C('gene.max')||meta.genes<C('gene.cost');
  $('geneUpgradeBtn').textContent=geneLevel>=C('gene.max')?'已达当前上限':`花费 ${C('gene.cost')} 基因 · 升级传承`;
  $('geneDescription').textContent=`每级初始香气 +${C('gene.aromaPerLevel')}，当前上限 ${C('gene.max')} 级；已购等级保留，实际初始香气 +${geneAroma()}。`;
  $('difficultySelect').innerHTML=Array.from({length:Math.min(meta.difficulty,C('difficulty.max'))+1},(_,i)=>`<option value="${i}">${i===0?'0 · 草甸初生':i+' · 荒野 '+i+' 阶'} · 敌速 +${percent(i*C('enemy.difficultySpeed'))}% / 胜利额外 ${i*C('settle.difficultyFood')} 粮、${i*C('settle.difficultyGenes')} 基因</option>`).join('');$('difficultySelect').value=runDifficulty();$('difficultySelect').disabled=locked;
  $('achievementList').innerHTML=Rogue.achievements(meta).map(a=>{
   const enabled=C(`achievements.${a.id}.enabled`)===1,status=a.claimed?'已领取':!enabled?'配置已停用':!a.unlocked?'未达门槛':locked?'结算后领取':'领取奖励';
   const progress=a.id==='swift'?`${a.progress===null?'暂无胜利记录':number(a.progress)+' 秒'} / 门槛 ≤ ${a.target} 秒`:`${a.progress} / ${a.target}`;
   return `<article class="achievement-card ${a.claimed?'claimed':''}"><div class="card-topline"><span>${a.claimed?'已领成就':'家族成就'}</span><span>${status}</span></div><h3>${a.name}</h3><p>${a.description}</p><p class="achievement-progress">进度 ${progress}</p><strong>奖励 ${a.food} 粮 · ${a.genes} 基因</strong><button class="button button-secondary" type="button" data-achievement="${a.id}" ${locked||!a.unlocked||a.claimed?'disabled':''}>${status}</button></article>`;
  }).join('');
  $('saveStatus').textContent=(locked?'远征中只可查看；结束后可升级、领奖或导入。 ':'')+storageMessage;$('importSaveBtn').disabled=locked;
  $('logList').replaceChildren(...(logs.length?logs:[`全新存档初始赠送 ${C('meta.initialFood')} 粮食；修改赠粮不影响已有进度。`,`交付奖励 = 背包粮食 + 球质量 × ${C('deliver.foodPerKg')}（质量折粮向下取整，受丰收进化影响）。`,`每局初始重掷 ${C('run.rerolls')} 次；危险区有养料和古老遗物。`]).map(text=>{const el=document.createElement('li');el.textContent=text;return el;}));
  renderRules();renderConfig();
 }
 function showDraft(reason='自然选择'){
  if(s.settled||s.hardTimedOut)return;
  setMode('draft');offered=Rogue.draft(s);$('draftTitle').textContent=reason;$('draftSubtitle').textContent=`从 ${offered.length} 项中选择一项，仅在本次远征生效。适应，而不是堆数值。`;drawCards();
 }
 function drawCards(){
  $('draftCards').innerHTML=offered.map((id,i)=>{const p=Rogue.PERKS.find(p=>p.id===id);return `<button class="draft-card" data-perk="${id}"><span class="card-topline">0${i+1} / ${p.tag}</span><span class="perk-orb">${['芽','足','壳'][i]}</span><h3>${p.name}</h3><p>${p.description}</p><span class="draft-card-bottom">${p.tag==='即时'?'即时生效':`等级 ${(s.perks[id]||0)+1} / ${p.max}`}<b>选择进化 →</b></span></button>`;}).join('');
  $('rerollBtn').textContent=`重掷选项 · 剩余 ${s.rerolls} 次`;$('rerollBtn').disabled=s.rerolls<=0;
 }
 $('draftCards').onclick=e=>{const b=e.target.closest('[data-perk]');if(!b||s.mode!=='draft')return;if(Rogue.select(s,b.dataset.perk,offered)){offered=[];checkpoint();sfx('collect');if(pendingDraft>0){pendingDraft--;showDraft('成长的馈赠');}else setMode('playing');updateHUD();}};
 $('rerollBtn').onclick=()=>{if(s.mode==='draft'&&s.rerolls>0){s.rerolls--;offered=Rogue.draft(s);drawCards();sfx('click');}};
 function begin(seed){
  if(meta.activeRun)return false;
  Rogue.initRun(s,meta,seed,meta.trait,runDifficulty());s.aroma=geneAroma();s.runSeed=seed;s.birdTimer=C('bird.first');s.birdWarning=0;s.weather='clear';s.risk=0;s.relicUsed=false;s.riskSeen=false;s.lastWeather='';s.riskSpawn=false;
  meta.activeRun={banked:0,startedSeed:seed};pendingDraft=0;checkpoint();renderMeta();showDraft('第一步，选择你的生存方式');
 }
 function finish(outcome){
  if(s.settled)return s.result;
  const previousDifficulty=meta.difficulty,result=Rogue.settle(s,meta,outcome);outcome=result.outcome;
  if(outcome==='win')meta.difficulty=Math.max(meta.difficulty,Math.min(C('difficulty.max'),s.difficulty+1));
  journal=null;addLog(`${result.reasonLabel}：已入库 ${result.banked} 粮，结算 +${result.recovered} 粮，损失 ${result.lost} 粮；后代 +${result.offspring}，基因 +${result.genes}。`);save();setMode('ended');renderMeta();
  ui.endTitle.textContent=s.hardTimedOut?'累计时长已达上限，此行暂告一段落。':outcome==='win'?'生命，终于有了回响。':outcome==='retreat'?'懂得归途，也是一种进化。':s.hp<=0?'远征落幕，巢穴仍在。':'暮色已至，来日再出发。';
  ui.endScore.textContent=result.score.toLocaleString('zh-CN');ui.endStats.innerHTML=`<div class="settlement-grid"><span>安全入库<b>${result.banked} 粮</b></span><span>本次结算<b>+${result.recovered} 粮</b></span><span>未带回损失<b>${result.lost} 粮</b></span><span>家族新生<b>+${result.offspring} 后代</b></span></div><p>基因 +${result.genes} · 总粮食 ${meta.food} · 已交付 ${s.delivered}/${Rogue.targets.reduce((sum,g)=>sum+g.count,0)} 颗</p><p>实战活跃 ${s.elapsed.toFixed(1)} 秒 · 普通采集 ${s.collected} 次 · 受击 ${s.hitCount} 次<br>试玩种子 ${s.runSeed} · 配置 ${Config.revision}</p><small>${s.hardTimedOut?`累计活跃时长达到 ${C('run.hardLimit')} 秒上限，续时不能延长此上限。`:outcome==='win'?`${meta.difficulty>previousDifficulty?'新难度已解锁。':'已完成当前挑战。'}回到「我的巢穴」升级、选择特质或领取成就。`:'本局进化已结束；永久升级、已入库粮食及后代不受影响。'}</small>`;
  sfx(outcome==='win'?'win':'hit');updateHUD();return result;
 }
 function deliver(){
  if(s.mode!=='playing'||s.settled||s.y>.5)return false;
  if(s.hardTimedOut){finish('fail');return false;}
  if(!s.relicUsed&&Math.hypot(s.x-24,s.z+7)<2.5){s.relicUsed=true;s.time=Math.max(0,s.time-C('relic.time'));s.pocket+=C('relic.food');checkpoint();updateHUD();if(s.time<=0){toast(`遗物交易：消耗 ${C('relic.time')} 秒，获得 ${C('relic.food')} 粮；倒计时耗尽，按失败结算。`,4000);finish('fail');return true;}toast(`遗物交易完成：-${C('relic.time')} 秒，+${C('relic.food')} 背包粮，并选择一次进化。`,4000);showDraft('荒野的馈赠 · 以时间换取进化');return true;}
  if(Math.hypot(s.x,s.z+10)>2.65)return false;
  if(!Rogue.ready(s)){toast('尚未达标：需要 '+Rogue.target(s).mass+' kg / '+Rogue.target(s).aroma+' 香气。');return false;}
  const hp=s.hp,result=Rogue.deliver(s,meta);if(!result.ok)return false;
  checkpoint();burst(0,1,-10,'#f6d46d',60);sfx('deliver');toast(`安全入库 +${result.banked} 粮，恢复 ${s.hp-hp} 点生命（每次最多 ${C('deliver.heal')}）。`);updateHUD();
  if(result.won)finish('win');else if(result.stageChange)showDraft(s.stage===1?'储备充足，启程寻找伴侣':'伴侣加入，为新生命做准备');
  return true;
 }
 function collected(result){checkpoint();if(result.levelUp)showDraft('采集成长 · 第 '+s.collected+' 份养料');}
 function hit(reason='抢球甲虫'){const hp=s.hp,time=s.time,r=Rogue.hit(s);if(!r.hit)return r;burst(s.x,.7,s.z,'#e5b68b',20);sfx('hit');toast(`${reason}！生命 -${hp-s.hp} · 球 -${r.loss.toFixed(1)} kg · 时间 -${number(time-s.time)} 秒`);checkpoint();if(r.dead||s.time<=0)finish('fail');return r;}
 function update(){
  const g=Rogue.target(s),isReady=Rogue.ready(s);
  $('healthText').textContent=`${s.hp} / ${s.maxHp}`;$('healthText').style.color=s.hp<=1?'#b44a35':'';$('aromaText').textContent=`${s.aroma} / ${g.aroma}`;$('pocketText').textContent=`${s.pocket} 粮`;
  $('stageName').textContent=g.name;$('deliveryTotal').textContent=g.count;ui.delivered.textContent=s.completed?g.count:s.stageDelivered;
  $('stageSteps').innerHTML=Rogue.targets.map((g,i)=>`<span class="stage-step ${s.stage===i?'active':''} ${s.stage>i?'completed':''}">${i+1} ${g.name}</span>`).join('');
  ui.targetFill.style.width=Math.min(100,s.mass/g.mass*100)+'%';ui.targetText.textContent=`${s.mass.toFixed(1)} / ${g.mass} kg · 香 ${s.aroma}/${g.aroma}`;
  ui.objective.textContent=isReady?'已经达标！继续滚大可增加折粮收益；也可以立即回巢交付。':`${g.description} 金色孢子基础提供 ${C('collect.goldAroma')} 香气。`;
  const weatherNames={clear:'晴朗',rain:`阵雨 · 地速 ×${C('move.rain')}`,drought:`燥热 · 冲刺耗能 ×${C('move.drought')}`};
  $('runInfo').textContent=`${weatherNames[s.weather]||'晴朗'}${s.risk?' / 外圈高危':' / '+(s.stage+1)+'阶段'}`;
  const names=Object.entries(s.perks).map(([id,n])=>`<span class="perk-chip">${Rogue.PERKS.find(p=>p.id===id).name} ${n}</span>`).join('');
  $('perkList').innerHTML=names||'<span class="perk-placeholder">开局选择进化后出发</span>';
  const near=s.mode==='playing'&&Math.hypot(s.x,s.z+10)<2.65,atRelic=s.mode==='playing'&&!s.relicUsed&&Math.hypot(s.x-24,s.z+7)<2.5;
  $('interactBtn').classList.toggle('hidden',!near&&!atRelic);$('interactBtn').disabled=(!atRelic&&!isReady)||s.y>.5;$('interactBtn').innerHTML=`<kbd>E</kbd><span>${atRelic?`遗物交易：-${C('relic.time')} 秒 / +${C('relic.food')} 粮 + 进化`:isReady?`交付 · 入库并最多回复 ${C('deliver.heal')} 生命`:'还差 '+Math.max(0,g.mass-s.mass).toFixed(1)+' kg / '+Math.max(0,g.aroma-s.aroma)+' 香气'}</span>`;
  $('interactBtn').setAttribute('aria-label',atRelic?`遗物交易，消耗 ${C('relic.time')} 秒，获得 ${C('relic.food')} 粮和进化，快捷键 E`:'交付达标小球，快捷键 E');
 }
 $('campBtn').onclick=()=>{if(s.mode==='draft'||s.mode==='camp')return;campReturn=s.mode;if(s.mode==='playing')setMode('paused');setMode('camp');renderMeta();};
 $('campClose').onclick=()=>{setMode(campReturn==='playing'?'paused':campReturn);};
 $('upgradeGrid').onclick=e=>{const b=e.target.closest('[data-upgrade]');if(!b||meta.activeRun)return;if(Rogue.buy(meta,b.dataset.upgrade)){save();refreshIdle();sfx('collect');toast('巢穴升级完成，下次远征生效。');}};
 $('traitGrid').onclick=e=>{const b=e.target.closest('[data-trait]');if(!b||meta.activeRun)return;const t=Rogue.TRAITS.find(t=>t.id===b.dataset.trait);if(t&&meta.offspring>=t.requireOffspring){meta.trait=t.id;save();refreshIdle();sfx('click');}};
 $('geneUpgradeBtn').onclick=()=>{if(meta.activeRun||geneLevel>=C('gene.max')||meta.genes<C('gene.cost'))return;meta.genes-=C('gene.cost');geneLevel++;save();refreshIdle();sfx('collect');toast(`香气传承已升至 ${geneLevel} 级，初始香气 +${geneAroma()}。`);};
 $('difficultySelect').onchange=e=>{const value=Number(e.target.value);if(!meta.activeRun&&Number.isInteger(value)&&value>=0&&value<=Math.min(meta.difficulty,C('difficulty.max'))){selectedDifficulty=value;save();refreshIdle();}};
 $('achievementList').onclick=e=>{const b=e.target.closest('[data-achievement]');if(!b||meta.activeRun)return;const a=Rogue.achievements(meta).find(a=>a.id===b.dataset.achievement);if(a&&Rogue.claim(meta,a.id)){const saved=save();renderMeta();updateHUD();sfx('collect');toast(`${a.name}已领取：+${a.food} 粮、+${a.genes} 基因。${saved?'':'当前仅临时有效，请导出备份。'}`);}};
 $('interactBtn').onclick=deliver;$('retreatBtn').onclick=()=>{if(s.mode==='paused')finish('retreat');};
 ui.restartBtn.onclick=()=>{if(s.mode==='paused')$('abandonModal').classList.remove('hidden');};
 $('abandonCancel').onclick=()=>$('abandonModal').classList.add('hidden');$('abandonConfirm').onclick=()=>{if(s.mode!=='paused')return;$('abandonModal').classList.add('hidden');finish('fail');restart();};
 function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
 $('exportSaveBtn').onclick=()=>{checkpoint();download(JSON.stringify(envelope(),null,2),'小小推球家-传承存档.json');toast('已导出存档（含成就统计与已领奖记录）。进行中的远征在恢复时按失败结算。');};
 $('importSaveBtn').onclick=()=>{if(!meta.activeRun)$('importSaveInput').click();};
 $('importSaveInput').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f||meta.activeRun)return;try{if(f.size>100000)throw Error('存档文件过大');const text=await f.text();if(meta.activeRun)throw Error('远征已开始，请结束后再恢复存档');const v=validEnvelope(JSON.parse(text));if(!confirm('恢复将覆盖当前巢穴进度（含成就统计与已领记录），不改变数值配置。建议先导出备份。确定恢复吗？'))return;if(meta.activeRun)throw Error('远征已开始，请结束后再恢复存档');({meta,geneLevel,selectedDifficulty,journal,logs}=v);recoverInterrupted();available=true;const saved=save();refreshIdle();toast(saved?'存档恢复成功。':'存档已恢复为临时进度，保存失败，请导出备份。');}catch(err){$('saveStatus').textContent='导入失败，原进度未改动：'+err.message;}};
 $('configImportBtn').onclick=()=>{if(!meta.activeRun&&!configBusy){configFeedback('请选择从调参台导出的完整配置 JSON。');$('configImportInput').click();}};
 $('configImportInput').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f||configBusy)return;
  try{
   requireIdle();configBusy=true;configMessage='正在读取并校验完整配置…';configError=false;renderConfig();
   if(f.size>1000000)throw Error('配置文件过大');
   const text=await f.text();requireIdle();const next=Config.validate(JSON.parse(text));requireIdle();
   if(!confirm('配置已完整校验。应用会替换当前数值配置，但保留玩家进度和已领奖记录；旧等级按新上限生效，初始赠粮只影响新档。确定应用吗？')){configFeedback('已取消导入，配置未改动。');return;}
   requireIdle();applyConfig(next);
  }catch(err){configFeedback('配置导入失败，原配置未改动：'+err.message,true);}
  finally{configBusy=false;renderConfig();}
 };
 $('configResetBtn').onclick=()=>{try{requireIdle();if(configBusy)return;if(!confirm('恢复默认数值配置？玩家进度、已购等级和成就已领记录会保留，不会重新发放初始赠粮。')){configFeedback('已取消恢复默认。');return;}resetConfig();}catch(err){configFeedback(err.message,true);}};
 $('configExportBtn').onclick=()=>{try{download(JSON.stringify(Config.export(),null,2),`小小推球家-数值配置-${Config.revision}.json`);configFeedback('当前配置已导出，不包含玩家存档。');}catch(err){configFeedback('配置导出失败：'+err.message,true);}};
 addEventListener('beforeunload',e=>{if(meta.activeRun){checkpoint();e.preventDefault();e.returnValue='';}});
 renderMeta();update();if(!available)setTimeout(()=>toast(storageMessage,6500),1000);
 return {begin,finish,deliver,collected,hit,update,showDraft,checkpoint,renderMeta,applyConfig,resetConfig,get meta(){return meta;},get geneLevel(){return geneLevel;},get offered(){return [...offered];},getEnvelope:()=>JSON.parse(JSON.stringify(envelope())),validEnvelope};
}

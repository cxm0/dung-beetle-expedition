import { Config } from './config.js';
import * as THREE from './three.module.js';
import { Rogue } from './rogue.js';
import { createExpedition } from './expedition.js';
const C = key => Config.get(key);
Config.load();
let expedition;

// All art is procedural. The game is self-contained and makes no network requests.
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['world','home','hud','startBtn','helpBtn','helpModal','helpClose','timer','score','mass','staminaFill','targetFill','targetText','delivered','toast','pauseBtn','soundBtn','qualityBtn','pauseModal','resumeBtn','restartBtn','endModal','endTitle','endScore','endStats','againBtn','homeBtn','mobileControls','joystick','stick','jumpBtn','dashBtn','compassArrow','objective','floatingLayer'].map(id => [id,$(id)]));
const clamp = THREE.MathUtils.clamp;
let seed = 71023;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
const range = (a,b) => a + random()*(b-a);
const TAU = Math.PI * 2;
const state = { mode:'home', time:C('run.baseTime'), score:0, mass:C('run.startMass'), delivered:0, stamina:C('run.staminaCap'), x:0, z:7, y:0, vy:0, heading:Math.PI, speed:0, invincible:0, combo:0, comboTime:0, collected:0, jumps:0, sound:true, quality:true };
const keys = new Set();
const touch = {x:0,y:0,dash:false};
let renderer;
try {
  renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
} catch (error) {
  ui.world.innerHTML = '<div style="position:absolute;inset:25%;padding:30px;background:#fffef7;border-radius:20px;z-index:99">浏览器没有启用 WebGL。请开启硬件加速后重新打开游戏。</div>';
  ui.startBtn.disabled = true;
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.18;
ui.world.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label','三维草甸，使用 WASD 推动小球');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e5ead8');
scene.fog = new THREE.Fog('#e5ead8',48,110);
const camera = new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.1,180);
camera.position.set(13,14,24);
const hemi = new THREE.HemisphereLight('#fff8df','#809367',2.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1ca',3.6);
sun.position.set(-14,25,12); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-26,right:26,top:26,bottom:-26,near:1,far:85});
sun.shadow.normalBias=.035; sun.shadow.bias=-.00015;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#d9f8e2',.8); fill.position.set(15,8,-10); scene.add(fill);
const geo = { sphere:new THREE.IcosahedronGeometry(1,1), smooth:new THREE.SphereGeometry(1,20,14), cone:new THREE.ConeGeometry(1,1,5), cylinder:new THREE.CylinderGeometry(1,1,1,12), disk:new THREE.CircleGeometry(1,36), leaf:new THREE.SphereGeometry(1,8,5), box:new THREE.BoxGeometry(1,1,1) };
const mat = (color,extra={}) => new THREE.MeshStandardMaterial({color,roughness:.85,...extra});
const palette = {grass:mat('#a8b76a'),soil:mat('#b79a68'),darkSoil:mat('#8c734e'),bark:mat('#796644'),leaf:mat('#748d43'),leafLight:mat('#a1b34c'),leafDark:mat('#557a3e'),petal:mat('#fff9de'),yellow:mat('#e1ad39'),stone:mat('#adb2a0'),ball:mat('#77573b',{roughness:1}),ballLight:mat('#93734c'),ballDark:mat('#59412e'),shell:mat('#245a4c',{metalness:.5,roughness:.27}),shellLight:mat('#458579',{metalness:.5,roughness:.25}),black:mat('#243c32'),eye:mat('#fff6de'),pupil:mat('#172f29')};
function mesh(g,m,parent=scene,x=0,y=0,z=0,sx=1,sy=sx,sz=sx) {
 const o = new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
}
// Static scenery is batched by geometry/material to keep draw calls bounded.
const batches = new Map(), dummy = new THREE.Object3D();
function instance(g,m,x,y,z,sx=1,sy=sx,sz=sx,rx=0,ry=0,rz=0){
 const key=g.uuid+m.uuid; if(!batches.has(key))batches.set(key,{g,m,transforms:[]});
 dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();batches.get(key).transforms.push(dummy.matrix.clone());
}
function flushBatches(){for(const {g,m,transforms} of batches.values()){const o=new THREE.InstancedMesh(g,m,transforms.length);transforms.forEach((a,i)=>o.setMatrixAt(i,a));o.castShadow=true;o.receiveShadow=true;scene.add(o);}batches.clear();}
const ground = mesh(new THREE.CylinderGeometry(34.8,35.8,2,96),palette.soil,scene,0,-1.1,0);
mesh(new THREE.CylinderGeometry(34.9,34.8,.25,96),palette.grass,scene,0,-.08,0);
const underside=mesh(new THREE.CylinderGeometry(35.2,33.2,1.1,80),palette.darkSoil,scene,0,-2.55,0);
const backdrop=mesh(new THREE.PlaneGeometry(500,500),mat('#e5e7d6'),scene,0,-3.2,0);backdrop.rotation.x=-Math.PI/2;backdrop.castShadow=false;
const patchMaterials=['#a3b168','#b4be7a','#99aa60','#bac180'].map(c=>mat(c));
for(let i=0;i<100;i++){const a=range(0,TAU),r=range(3,33);instance(geo.disk,patchMaterials[i%4],Math.cos(a)*r,.055+i*.00003,Math.sin(a)*r,range(.8,3.3),range(.6,2.8),1,-Math.PI/2);}
const trailMat=mat('#c0bb83');
for(let i=0;i<100;i++){const z=-30+i*.6;const x=Math.sin(z*.12)*6;instance(geo.disk,trailMat,x,.061,z,1.25,.65,1,-Math.PI/2);}
const obstacles=[], mushrooms=[], ponds=[];
function grass(x,z,size=1){for(let i=0;i<3;i++){const a=range(0,TAU),h=range(.3,.85)*size;instance(geo.cone,i%2?palette.leaf:palette.leafLight,x+Math.cos(a)*.12,h*.45,z+Math.sin(a)*.12,.075*size,h,.075*size,range(-.22,.22),a,range(-.22,.22));}}
for(let i=0;i<1900;i++){const a=range(0,TAU),r=Math.sqrt(random())*34;grass(Math.cos(a)*r,Math.sin(a)*r,range(.5,1.25));}
function flower(x,z,size=1,color=palette.petal){
 const h=range(.6,1.1)*size;instance(geo.cylinder,palette.leafDark,x,h/2,z,.027*size,h,.027*size);
 for(let p=0;p<6;p++){const a=p/6*TAU;instance(geo.leaf,color,x+Math.cos(a)*.18*size,h,z+Math.sin(a)*.18*size,.23*size,.055*size,.105*size,0,-a,0);}
 instance(geo.sphere,palette.yellow,x,h+.045,z,.12*size,.07*size,.12*size);
 instance(geo.leaf,palette.leaf,x+.11*size,h*.5,z,.22*size,.035*size,.09*size,0,.3,-.4);
}
const pink=mat('#dca7ab');
for(let i=0;i<145;i++){const a=range(0,TAU),r=range(9,34);flower(Math.cos(a)*r,Math.sin(a)*r,range(.6,1.6),i%5===0?pink:palette.petal);}
function mushroom(x,z,size=1){
 const g=new THREE.Group();scene.add(g);g.position.set(x,0,z);
 mesh(geo.cylinder,mat('#eee0ba'),g,0,.43*size,0,.16*size,.86*size,.16*size);
 const cap=mesh(new THREE.SphereGeometry(1,20,10,0,TAU,0,Math.PI/2),mat('#ca7753'),g,0,.73*size,0,.7*size,.42*size,.7*size);
 mesh(geo.disk,mat('#e9c7a2'),g,0,.735*size,0,.69*size).rotation.x=Math.PI/2;
 for(let i=0;i<7;i++){const a=i*2.4,r=.42*Math.sqrt((i+.5)/7);mesh(geo.smooth,palette.petal,g,Math.cos(a)*r*size,(.75+Math.sqrt(1-r*r/.49)*.4)*size,Math.sin(a)*r*size,.08*size,.026*size,.08*size);}
 mushrooms.push({x,z,r:.65*size,g,cooldown:0});
}
mushroom(5,3,1.8);mushroom(-7,-4,1.5);mushroom(12,-12,1.4);mushroom(-15,12,1.8);mushroom(23,3,1.3);
for(let i=0;i<30;i++){const a=range(0,TAU),r=range(25,34),x=Math.cos(a)*r,z=Math.sin(a)*r,s=range(.5,1.6);instance(geo.sphere,palette.stone,x,.35*s,z,s,.65*s,.85*s,.15,range(0,TAU));obstacles.push({x,z,r:s*.85});}
// Broad translucent puddles slow movement but do not trap the player.
const waterMat=mat('#78aead',{transparent:true,opacity:.7,metalness:.25,roughness:.19});
for(const [x,z,r] of [[-11,3,2.7],[10,-5,2.3],[-3,21,2.6]]){
 const o=mesh(geo.disk,waterMat,scene,x,.081,z,r,r*.75,1);o.rotation.x=-Math.PI/2;o.castShadow=false;ponds.push({x,z,r:r*.9});
 const rim=mesh(new THREE.RingGeometry(r*.95,r,48),mat('#98b5a0'),scene,x,.09,z);rim.rotation.x=-Math.PI/2;rim.scale.y=.75;rim.castShadow=false;
 for(let j=0;j<4;j++){const a=j*2.4;instance(geo.leaf,palette.leafDark,x+Math.cos(a)*r*.65,.12,z+Math.sin(a)*r*.5,.36,.035,.25,0,a);}
}
// A few giant clovers and a fallen branch frame the miniature scene.
for(let i=0;i<30;i++){const a=range(0,TAU),r=range(27,34),x=Math.cos(a)*r,z=Math.sin(a)*r,h=range(1.2,3);instance(geo.cylinder,palette.leafDark,x,h/2,z,.045,h,.045,0,0,.08);for(let j=0;j<3;j++){const b=j/3*TAU;instance(geo.leaf,j%2?palette.leafLight:palette.leaf,x+Math.cos(b)*.45,h,z+Math.sin(b)*.45,.65,.08,.42,.1,-b,.1);}}
for(let i=0;i<8;i++){const x=14+i*.55,z=14-i*.1;instance(geo.cylinder,palette.bark,x,.43,z,.48,.6,.48,0,0,Math.PI/2);obstacles.push({x,z,r:.5});}
// Foreground botanical details close to the hero.
flower(3.6,6,1.7);flower(4.1,6.6,1.3);flower(-2.8,5,1.8);flower(6.4,2,1.9);grass(3.6,5.5,1.7);
flushBatches();

const nest={x:0,z:-10,r:2.4};
const nestGroup=new THREE.Group();nestGroup.position.set(nest.x,.12,nest.z);scene.add(nestGroup);
const nestCenter=mesh(geo.disk,mat('#626d3c'),nestGroup,0,0,0,2.4);nestCenter.rotation.x=-Math.PI/2;nestCenter.castShadow=false;
const nestRing=mesh(new THREE.TorusGeometry(2.25,.13,8,64),mat('#ecc964',{emissive:'#e6b93e',emissiveIntensity:.4}),nestGroup,0,.08,0);nestRing.rotation.x=-Math.PI/2;
for(let i=0;i<20;i++){const a=i/20*TAU;const twig=mesh(geo.cylinder,palette.bark,nestGroup,Math.cos(a)*2.6,.12,Math.sin(a)*2.6,.08,.8,.08);twig.rotation.set(Math.PI/2,0,-a);}
const beacon=mesh(new THREE.CylinderGeometry(.7,1.7,5,24,1,true),new THREE.MeshBasicMaterial({color:'#ffe39b',transparent:true,opacity:.1,depthWrite:false,side:THREE.DoubleSide}),nestGroup,0,2.5,0);beacon.castShadow=false;
function label(text){const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='rgba(255,254,238,.92)';ctx.beginPath();ctx.roundRect(4,4,504,120,30);ctx.fill();ctx.fillStyle='#43583b';ctx.font='bold 39px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillText(text,256,79);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false,transparent:true}));sp.scale.set(4.8,1.2,1);return sp;}
const homeLabel=label('HOME  /  小小的家');homeLabel.position.set(0,4,-10);scene.add(homeLabel);

function createBeetle(shellMaterial=palette.shell){
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);scene.add(root);
 mesh(geo.smooth,palette.black,body,0,.5,-.16,.59,.38,.83);
 for(const sign of [-1,1]){
  const wing=mesh(geo.smooth,shellMaterial,body,sign*.265,.64,-.28,.305,.33,.71);wing.rotation.z=-sign*.16;
  const stripe=mesh(geo.leaf,palette.shellLight,body,sign*.31,.84,-.31,.055,.025,.4);stripe.rotation.z=sign*.25;
 }
 mesh(geo.smooth,shellMaterial,body,0,.55,.55,.44,.31,.35);
 mesh(geo.smooth,palette.black,body,0,.46,.84,.34,.23,.27);
 for(const sign of [-1,1]){
  mesh(geo.smooth,palette.eye,body,sign*.25,.59,.94,.115,.13,.08);
  mesh(geo.smooth,palette.pupil,body,sign*.25,.60,1.008,.065,.077,.032);
  const antenna=mesh(geo.cylinder,palette.black,body,sign*.28,.83,.97,.025,.39,.025);antenna.rotation.z=-sign*.45;antenna.rotation.x=.35;
  mesh(geo.smooth,palette.yellow,body,sign*.365,1.01,1.025,.045);
 }
 const legs=[];
 for(const sign of [-1,1])for(let j=0;j<3;j++){
  const pivot=new THREE.Group();pivot.position.set(sign*.36,.4,.49-j*.55);body.add(pivot);
  const upper=mesh(geo.cylinder,palette.black,pivot,sign*.29,-.05,.03,.055,.65,.055);upper.rotation.z=sign*1.3;
  const knee=new THREE.Group();knee.position.set(sign*.57,-.15,.02);pivot.add(knee);
  const lower=mesh(geo.cylinder,palette.black,knee,sign*.07,-.19,.11,.043,.46,.043);lower.rotation.z=sign*.3;lower.rotation.x=-.4;
  mesh(geo.smooth,palette.black,knee,sign*.14,-.4,.21,.085,.045,.16);
  legs.push({pivot,j,sign});
 }
 return {root,body,legs};
}
const player=createBeetle();
const ballGroup=new THREE.Group();scene.add(ballGroup);
const ballSpin=new THREE.Group();ballGroup.add(ballSpin);
mesh(new THREE.IcosahedronGeometry(1,3),palette.ball,ballSpin);
for(let i=0;i<80;i++){const y=range(-1,1),a=range(0,TAU),r=Math.sqrt(1-y*y),s=range(.065,.15);mesh(geo.sphere,i%3===0?palette.ballDark:palette.ballLight,ballSpin,Math.cos(a)*r*.97,y*.97,Math.sin(a)*r*.97,s,s*.6,s);}
for(let i=0;i<12;i++){const y=range(-.85,.85),a=range(0,TAU),r=Math.sqrt(1-y*y);const straw=mesh(geo.cylinder,palette.soil,ballSpin,Math.cos(a)*r,y,Math.sin(a)*r,.014,.23,.014);straw.rotation.set(range(0,3),0,range(0,3));}
const contactMat=new THREE.MeshBasicMaterial({color:'#3d492b',transparent:true,opacity:.16,depthWrite:false});
const ballShadow=mesh(geo.disk,contactMat,scene,0,.085,0);ballShadow.rotation.x=-Math.PI/2;ballShadow.castShadow=false;
const playerShadow=mesh(geo.disk,contactMat,scene,0,.086,0);playerShadow.rotation.x=-Math.PI/2;playerShadow.castShadow=false;
const enemies=[];
const rivalShell=mat('#975b46',{metalness:.25,roughness:.4});
for(let i=0;i<5;i++){const b=createBeetle(rivalShell);b.root.scale.setScalar(.82);enemies.push({...b,x:0,z:0,angle:i*TAU/5,phase:i*2.1,stun:0});}
const companion=createBeetle(mat('#826c97',{metalness:.4,roughness:.3}));companion.root.scale.setScalar(.8);companion.root.visible=false;
const babies=[];for(let i=0;i<4;i++){const b=createBeetle(palette.shellLight);b.root.scale.setScalar(.32);b.root.position.set(-1.3+i*.8,.1,-10.7);b.root.visible=false;babies.push(b);}
const foodPile=new THREE.Group();scene.add(foodPile);for(let i=0;i<5;i++)mesh(geo.sphere,palette.ballLight,foodPile,-2+(i%3)*.4,.3+Math.floor(i/3)*.35,-10,.32);
foodPile.visible=false;
const riskRing=mesh(new THREE.RingGeometry(21.8,22,128),new THREE.MeshBasicMaterial({color:'#b87549',transparent:true,opacity:.27,side:THREE.DoubleSide}),scene,0,.1,0);riskRing.rotation.x=-Math.PI/2;riskRing.castShadow=false;
const relic=mesh(new THREE.OctahedronGeometry(.7),mat('#efc962',{metalness:.55,emissive:'#a9781e',emissiveIntensity:.25}),scene,24,1.2,-7);
const relicLabel=label('古老遗物 / 进化与代价');relicLabel.position.set(24,3.3,-7);scene.add(relicLabel);
const birdCircle=mesh(new THREE.RingGeometry(2.65,2.85,64),new THREE.MeshBasicMaterial({color:'#d44c31',transparent:true,opacity:.75,side:THREE.DoubleSide}),scene,0,.16,0);birdCircle.rotation.x=-Math.PI/2;birdCircle.visible=false;birdCircle.castShadow=false;
const birdShadow=mesh(geo.disk,new THREE.MeshBasicMaterial({color:'#532d2a',transparent:true,opacity:.14,depthWrite:false}),scene,0,.17,0,2.8);birdShadow.rotation.x=-Math.PI/2;birdShadow.visible=false;birdShadow.castShadow=false;
// Pickups are a single instanced mesh per type, not hundreds of draw calls.
const pickups=[];
const pelletMesh=new THREE.InstancedMesh(geo.sphere,mat('#785436'),300);pelletMesh.castShadow=true;scene.add(pelletMesh);
const goldMesh=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.22),mat('#ecc752',{metalness:.3,emissive:'#bd8f18',emissiveIntensity:.35}),80);goldMesh.castShadow=true;scene.add(goldMesh);
function createPickups(){const n=C('world.normalCount'),gCount=C('world.goldCount'),total=n+gCount;pickups.length=0;pelletMesh.count=n;goldMesh.count=gCount;for(let i=0;i<total;i++){
 let x,z;if(i<8){x=Math.sin(i*.9)*1.8;z=4.5-i*1.4;}else if(i>=n){const a=(i-n)/gCount*TAU+.3,r=12+(i%4)*4;x=Math.cos(a)*r;z=Math.sin(a)*r;}else{const a=range(0,TAU),r=Math.sqrt(range(64,841));x=Math.cos(a)*r;z=Math.sin(a)*r;}
 if(Math.hypot(x-nest.x,z-nest.z)<5){const a=Math.atan2(z-nest.z,x-nest.x);x=nest.x+Math.cos(a)*5.2;z=nest.z+Math.sin(a)*5.2;}
 pickups.push({x,z,gold:i>=n,index:i>=n?i-n:i,active:true,respawn:0,value:(i<8?C('world.starterMass'):range(C('world.normalMin'),C('world.normalMax')))*(Math.hypot(x,z)>C('world.riskRadius')?C('world.outerBonus'):1),phase:range(0,TAU)});
}riskRing.scale.setScalar(C('world.riskRadius')/22);}
createPickups();
const particleMesh=new THREE.InstancedMesh(geo.sphere,new THREE.MeshBasicMaterial({color:'#ffffff'}),160);particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(particleMesh);particleMesh.frustumCulled=false;
const particles=Array.from({length:160},()=>({life:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,size:.1,color:new THREE.Color()}));let particleIndex=0;
function burst(x,y,z,color,count=12){for(let i=0;i<count;i++){const p=particles[particleIndex++%particles.length];Object.assign(p,{life:range(.35,.8),maxLife:.8,x,y,z,vx:range(-3,3),vy:range(2,5),vz:range(-3,3),size:range(.035,.13)});p.color.set(color);}}
const pollenGeometry=new THREE.BufferGeometry(),pollenArray=new Float32Array(90*3);
for(let i=0;i<90;i++){pollenArray[i*3]=range(-30,30);pollenArray[i*3+1]=range(.3,6);pollenArray[i*3+2]=range(-30,30);}
pollenGeometry.setAttribute('position',new THREE.BufferAttribute(pollenArray,3));
const pollen=new THREE.Points(pollenGeometry,new THREE.PointsMaterial({color:'#fff5ce',size:.075,transparent:true,opacity:.65}));scene.add(pollen);
// Butterflies have articulated wings, following deterministic looping paths.
const butterflies=[];
for(let i=0;i<6;i++){const g=new THREE.Group();scene.add(g);const wings=[];for(const s of [-1,1]){const w=mesh(geo.leaf,i%2?pink:palette.yellow,g,s*.17,0,0,.23,.025,.15);w.castShadow=false;wings.push(w);}mesh(geo.sphere,palette.black,g,0,0,0,.035,.035,.15);butterflies.push({g,wings,phase:i*1.9});}

let audioContext,master,melodyStep=0,musicClock=0;
function initAudio(){try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(!master){master=audioContext.createGain();master.gain.value=.16;master.connect(audioContext.destination);}audioContext.resume();}catch{}}
function tone(freq=440,duration=.15,type='sine',volume=.3,delay=0){if(!state.sound||!audioContext||!master)return;const t=audioContext.currentTime+delay,o=audioContext.createOscillator(),g=audioContext.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(volume,t+.012);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(master);o.start(t);o.stop(t+duration+.02);o.onended=()=>{o.disconnect();g.disconnect();};}
function sfx(type){if(type==='collect'){tone(460+Math.min(state.combo,10)*55,.15,'sine',.45);tone(920,.08,'sine',.1,.05);}else if(type==='jump'){tone(280,.15,'triangle',.3);tone(420,.12,'sine',.2,.07);}else if(type==='hit'){tone(90,.25,'sawtooth',.2);}else if(type==='deliver'||type==='win'){[523,659,784,1047].forEach((f,i)=>tone(f,.4,'sine',.4,i*.11));}else tone(600,.07,'sine',.3);}
let toastTimeout;
function toast(text,duration=2700){clearTimeout(toastTimeout);ui.toast.textContent=text;ui.toast.classList.remove('hidden');toastTimeout=setTimeout(()=>ui.toast.classList.add('hidden'),duration);}
function floatText(text,pos,color='#48623b'){const el=document.createElement('span');el.textContent=text;el.style.cssText=`position:absolute;color:${color};font-size:19px;transition:transform 1s ease-out,opacity 1s;white-space:nowrap;`;const v=new THREE.Vector3(pos.x,pos.y+1.5,pos.z).project(camera);el.style.left=(v.x*.5+.5)*innerWidth+'px';el.style.top=(-v.y*.5+.5)*innerHeight+'px';ui.floatingLayer.appendChild(el);requestAnimationFrame(()=>{el.style.transform='translateY(-65px)';el.style.opacity='0';});setTimeout(()=>el.remove(),1100);}
function setMode(mode){state.mode=mode;ui.home.classList.toggle('hidden',mode!=='home');ui.hud.classList.toggle('hidden',['home','camp'].includes(mode));ui.mobileControls.classList.toggle('hidden',mode!=='playing');ui.pauseModal.classList.toggle('hidden',mode!=='paused');ui.endModal.classList.toggle('hidden',mode!=='ended');$('draftModal').classList.toggle('hidden',mode!=='draft');$('campModal').classList.toggle('hidden',mode!=='camp');$('campBtn').disabled=mode==='draft';ui.pauseBtn.disabled=!['playing','paused'].includes(mode);$('interactBtn').classList.add('hidden');if(mode!=='playing')$('dangerBanner').classList.add('hidden');keys.clear();touch.x=touch.y=0;touch.dash=false;ui.stick.style.transform='translate(0px,0px)';ui.dashBtn.classList.remove('is-active');ui.jumpBtn.classList.remove('is-active');}
function start(){if(expedition.meta.activeRun&&!state.settled)return;const seedText=$('trialSeed').value.trim();if(seedText!==''&&(!Number.isInteger(Number(seedText))||Number(seedText)<0||Number(seedText)>4294967295)){toast('试玩种子必须为 0 至 4294967295 的整数，或留空随机。');return;}initAudio();seed=seedText!==''?Number(seedText):new URLSearchParams(location.search).has('test')?71023:crypto.getRandomValues(new Uint32Array(1))[0];const requestedSeed=seed;Object.assign(state,{x:0,z:7,y:0,vy:0,heading:Math.PI,speed:0,comboTime:0,jumps:0});createPickups();enemies.forEach(e=>{e.x=Math.sin(e.phase+1)*17;e.z=Math.cos(e.phase+1)*17;e.stun=0;});particles.forEach(p=>p.life=0);mushrooms.forEach(m=>m.cooldown=0);ui.helpModal.classList.add('hidden');birdCircle.visible=false;birdShadow.visible=false;expedition.begin(requestedSeed);updateHUD();toast('先储粮，再求偶，最后育幼。达标后在巢穴按 E 交付。',4500);sfx('click');}
function finish(won){return expedition.finish(won?'win':'fail');}
function pause(){if(state.mode==='playing'){setMode('paused');sfx('click');}else if(state.mode==='paused'){setMode('playing');sfx('click');}}
function jump(power=C('move.jump')){if(state.mode==='playing'&&state.y<=.025){state.vy=power+Rogue.stats(state).jump;state.y=.03;state.jumps++;sfx('jump');burst(state.x,.25,state.z,'#d6c998',7);}}
function updateHUD(){ui.timer.textContent=`${String(Math.floor(Math.max(state.time,0)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(state.time,0)%60)).padStart(2,'0')}`;ui.timer.style.color=state.time<30?'#aa523d':'';ui.score.textContent=state.score.toLocaleString('zh-CN');ui.mass.textContent=state.mass.toFixed(1);ui.staminaFill.style.width=clamp(state.stamina/C('run.staminaCap')*100,0,100)+'%';expedition?.update();const dx=nest.x-state.x,dz=nest.z-state.z;const sx=dx*.874-dz*.486,sy=dx*-.486+dz*-.874;ui.compassArrow.style.transform=`rotate(${Math.atan2(sx,sy)*180/Math.PI}deg)`;}
const radius=()=>.62*Math.cbrt(state.mass);
function simulate(dt,t){
 if(state.mode!=='playing'||state.settled)return;
 Rogue.tick(state,dt);if(state.time<=0){finish(false);return;}
 const attributes=Rogue.stats(state);state.comboTime-=dt;if(state.comboTime<=0)state.combo=0;
 state.risk=Math.hypot(state.x,state.z)>C('world.riskRadius')?1:0;
 const weatherIndex=(Math.floor(state.elapsed/C('move.weatherPeriod'))+(state.runSeed%3))%3;
 state.weather=['clear','rain','drought'][weatherIndex];
 if(state.lastWeather!==state.weather){state.lastWeather=state.weather;if(state.elapsed>1)toast(state.weather==='rain'?`阵雨来临：地面速度 ×${C('move.rain')}，跳跃不受影响。`:state.weather==='drought'?`燥热来临：冲刺体力消耗 ×${C('move.drought')}。`:'天色放晴，草甸恢复平静。',2200);}
 if(state.risk&&!state.riskSeen){state.riskSeen=true;toast(`进入外圈：养料质量 ×${C('world.outerBonus')}，鸟袭间隔额外缩短 ${C('bird.riskReduction')} 秒（最低 ${C('bird.minInterval')} 秒）。`,3200);}
 state.birdTimer-=dt;
 if(state.birdWarning>0){state.birdWarning-=dt;birdCircle.material.opacity=.45+Math.sin(state.elapsed*18)*.3;if(state.birdWarning<=0){birdCircle.visible=birdShadow.visible=false;burst(state.birdX,.25,state.birdZ,'#b59679',25);if(Math.hypot(state.x-state.birdX,state.z-state.birdZ)<C('bird.radius')){expedition.hit('鸟袭');if(state.mode!=='playing')return;}}}
 else if(state.birdTimer<=0){state.birdTimer=Math.max(C('bird.minInterval'),C('bird.baseInterval')-state.stage*C('bird.stageReduction')-state.difficulty*C('bird.difficultyReduction')-state.risk*C('bird.riskReduction'));if(Math.hypot(state.x,state.z+10)>4){state.birdWarning=C('bird.warning');state.birdX=state.x;state.birdZ=state.z;birdCircle.position.set(state.x,.16,state.z);birdCircle.scale.setScalar(C('bird.radius')/2.8);birdShadow.position.set(state.x,.17,state.z);birdShadow.scale.setScalar(C('bird.radius'));birdCircle.visible=birdShadow.visible=true;}}
 $('dangerBanner').classList.toggle('hidden',state.birdWarning<=0);
 // The relic trade is voluntary: the E interaction shows its exact cost before accepting.
 let ix=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touch.x;
 let iy=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+touch.y;
 const len=Math.hypot(ix,iy);if(len>1){ix/=len;iy/=len;}
 const moving=len>.08,boost=moving&&(keys.has('ShiftLeft')||keys.has('ShiftRight')||touch.dash)&&state.stamina>1;
 state.stamina=clamp(state.stamina+(boost?-C('move.drain')*attributes.drain*(state.weather==='drought'?C('move.drought'):1):C('move.regen')*attributes.regen)*dt,0,C('run.staminaCap'));
 const inWater=state.y<.3&&ponds.some(p=>Math.hypot(p.x-state.x,p.z-state.z)<p.r);
 const desired=(moving?(boost?C('move.dash'):C('move.walk')):0)*attributes.speed*(inWater?C('move.water'):1)*(state.weather==='rain'&&state.y<.3?C('move.rain'):1)*(1-Math.min(state.mass,15)*.008);
 state.speed=THREE.MathUtils.damp(state.speed,desired,8,dt);
 const dx=ix*.874+iy*.486,dz=-ix*.486+iy*.874;
 if(moving){const target=Math.atan2(dx,dz);state.heading+=Math.atan2(Math.sin(target-state.heading),Math.cos(target-state.heading))*Math.min(1,dt*13);}
 const vx=moving?dx:Math.sin(state.heading),vz=moving?dz:Math.cos(state.heading);
 state.x+=vx*state.speed*dt;state.z+=vz*state.speed*dt;
 const boundary=Math.hypot(state.x,state.z),maxR=33-radius();if(boundary>maxR){state.x*=maxR/boundary;state.z*=maxR/boundary;}
 for(const rock of obstacles){const d=Math.hypot(state.x-rock.x,state.z-rock.z),limit=rock.r+radius()*.8;if(d<limit&&state.y<rock.r){const a=Math.atan2(state.x-rock.x,state.z-rock.z);state.x=rock.x+Math.sin(a)*limit;state.z=rock.z+Math.cos(a)*limit;state.speed*=.65;}}
 state.vy-=19*dt;state.y+=state.vy*dt;if(state.y<0){if(state.vy<-4)burst(state.x,.2,state.z,'#c0b585',7);state.y=0;state.vy=0;}
 for(const m of mushrooms){m.cooldown=Math.max(0,m.cooldown-dt);if(m.cooldown<=0&&state.y<.5&&Math.hypot(state.x-m.x,state.z-m.z)<m.r+radius()*.5){state.vy=10;state.y=.08;m.cooldown=1.1;burst(state.x,1,state.z,'#f4d7aa',18);sfx('jump');toast('蘑菇蹦床！来一次轻盈的大跳跃。',1700);}}
 const pickupRange=radius()+C('world.pickupPadding')+attributes.magnet;
 for(const p of pickups){if(!p.active){p.respawn-=dt;if(p.respawn<=0)p.active=true;continue;}if(state.y<1.6&&Math.hypot(p.x-state.x,p.z-state.z)<pickupRange){p.active=false;p.respawn=p.gold?C('world.goldRespawn'):C('world.normalRespawn');
  const wasReady=Rogue.ready(state),result=Rogue.collect(state,p.value,p.gold);state.comboTime=3.5;
  if(p.gold){state.score+=C('collect.goldScore');burst(p.x,.7,p.z,'#f7db68',12);floatText(`香气 +${result.aromaGain} · 体力全满`,{x:p.x,y:.7,z:p.z},'#a38025');tone(1100,.3,'sine',.5);}
  else{burst(p.x,.3,p.z,'#ba9755',7);floatText(`+${result.massGain.toFixed(1)} kg${state.combo>=C('collect.comboStep')?' · '+Math.min(C('collect.comboMax'),Math.ceil(state.combo/C('collect.comboStep')))+'×':''}`,{x:p.x,y:.5,z:p.z});sfx('collect');}
  if(!wasReady&&Rogue.ready(state))toast('质量与香气达标！回巢按 E 交付，或冒险滚得更大。',3500);
  expedition.collected(result);if(state.mode!=='playing')return;
 }}
 for(let i=0;i<enemies.length;i++){const e=enemies[i];if(i>=C('enemy.baseCount')+state.stage*C('enemy.perStage'))continue;e.stun=Math.max(0,e.stun-dt);if(e.stun>0)continue;
  const centerX=Math.sin(e.phase)*12,centerZ=Math.cos(e.phase)*12;const safe=Math.hypot(state.x,state.z+10)<4;const chase=!safe&&Math.hypot(state.x-e.x,state.z-e.z)<6+state.stage;let tx,tz;if(chase){tx=state.x;tz=state.z;}else{tx=centerX+Math.cos(t*.23+e.phase)*4;tz=centerZ+Math.sin(t*.23+e.phase)*4;}
  const ex=tx-e.x,ez=tz-e.z,l=Math.hypot(ex,ez);if(l>.1){const v=(chase?C('enemy.chase')+state.stage*C('enemy.stageSpeed'):C('enemy.patrol'))*(1+state.difficulty*C('enemy.difficultySpeed'));e.x+=ex/l*v*dt;e.z+=ez/l*v*dt;e.angle=Math.atan2(ex,ez);}
  if(!safe&&state.invincible<=0&&state.y<.65&&Math.hypot(state.x-e.x,state.z-e.z)<radius()+.62){
   if(boost&&attributes.thorns){e.stun=2.5;burst(e.x,.5,e.z,'#a0c18b',14);toast('荆棘冲锋：撞晕对手！',1500);}
   else{expedition.hit();if(state.mode!=='playing')return;const a=Math.atan2(state.x-e.x,state.z-e.z);state.x+=Math.sin(a)*1.3;state.z+=Math.cos(a)*1.3;}
  }
 }
 if(state.speed>2&&Math.sin(t*30)>.8)burst(state.x,.13,state.z,inWater?'#b0d6d0':'#c5be8d',boost?2:1);
}
function animateBeetle(b,t,speed){b.legs.forEach(({pivot,j,sign})=>{const wave=Math.sin(t*(speed>0?12:2)+j*2.1+(sign===1?Math.PI:0));pivot.rotation.y=wave*.33*Math.min(1,speed*.4);pivot.rotation.x=Math.max(0,wave)*.35*Math.min(1,speed*.4);});b.body.rotation.z=Math.sin(t*9)*.035*Math.min(1,speed);b.body.position.y=Math.sin(t*18)*.025*Math.min(1,speed);}
const look=new THREE.Vector3(-5,0,4),camTarget=new THREE.Vector3(),lookTarget=new THREE.Vector3();
let last=performance.now(),time=0,hudClock=0;
function render(now){requestAnimationFrame(render);const dt=Math.min((now-last)/1000,.04);last=now;const active=state.mode==='playing'||state.mode==='home';if(active)time+=dt;
 if(state.mode==='playing'){simulate(dt,time);hudClock+=dt;if(hudClock>.08){updateHUD();hudClock=0;}musicClock+=dt;if(musicClock>1.05){musicClock=0;const notes=[261.63,329.63,392,523.25,440,392,329.63,293.66];tone(notes[melodyStep++%notes.length],.8,'sine',.065);}}
 const isHome=state.mode==='home',r=isHome?1.3:radius();
 if(isHome){state.x=0;state.z=4;state.y=0;state.heading=2.35;player.root.scale.setScalar(1.35);}else player.root.scale.setScalar(1);
 const off=r+(isHome?1.3:1.0);
 player.root.position.set(state.x-Math.sin(state.heading)*off,state.y,state.z-Math.cos(state.heading)*off);
 player.root.rotation.y=state.heading;
 player.body.visible=!(state.invincible>0&&Math.sin(time*30)<-.5);
 animateBeetle(player,time,isHome?.25:state.speed);
 ballGroup.position.set(state.x,r+state.y,state.z);ballGroup.scale.setScalar(r);
 if(active){if(isHome)ballSpin.rotation.y+=dt*.06;else{const axis=new THREE.Vector3(Math.cos(state.heading),0,-Math.sin(state.heading));ballSpin.rotateOnWorldAxis(axis,state.speed*dt/Math.max(r,.1));}}
 ballShadow.position.set(state.x,.09,state.z);ballShadow.scale.setScalar(r*(1-state.y*.07));ballShadow.material.opacity=.17/(1+state.y*.3);
 playerShadow.position.set(player.root.position.x,.092,player.root.position.z);playerShadow.scale.set(1.1/(1+state.y*.1),1.1/(1+state.y*.1),1);
 for(let i=0;i<enemies.length;i++){const e=enemies[i];e.root.visible=i<C('enemy.baseCount')+(isHome?0:state.stage)*C('enemy.perStage');if(isHome){e.x=Math.sin(e.phase+1)*17;e.z=Math.cos(e.phase+1)*17;}e.root.position.set(e.x,0,e.z);e.root.rotation.y=e.angle;e.body.rotation.x=e.stun>0?.4:0;animateBeetle(e,time,state.mode==='playing'?2:0);}
 companion.root.visible=!isHome&&state.stage>=2;companion.root.position.set(2,.05,-10);companion.root.rotation.y=-1;animateBeetle(companion,time,.2);
 babies.forEach((b,i)=>{b.root.visible=!isHome&&(state.completed||state.stage===2&&i<state.stageDelivered*2);animateBeetle(b,time,.4);});
 foodPile.visible=!isHome&&state.delivered>0;foodPile.scale.setScalar(Math.min(1.7,.7+state.delivered*.18));
 relic.visible=relicLabel.visible=isHome||!state.relicUsed;relic.rotation.y=time*.7;relic.position.y=1.2+Math.sin(time*2)*.14;
 const rain=!isHome&&state.weather==='rain';sun.intensity=rain?2:3.6;hemi.intensity=rain?2.1:2.6;scene.background.set(rain?'#cadcd9':'#e5ead8');scene.fog.color.copy(scene.background);
 for(const p of pickups){dummy.position.set(p.x,p.gold?.65+Math.sin(time*2+p.phase)*.15:.22,p.z);dummy.rotation.set(p.gold?time*.6:0,p.phase+time*(p.gold?.7:0),p.gold?Math.PI/4:0);dummy.scale.setScalar(p.active?(p.gold?1:.21+p.value*.07):0);dummy.updateMatrix();(p.gold?goldMesh:pelletMesh).setMatrixAt(p.index,dummy.matrix);}
 goldMesh.instanceMatrix.needsUpdate=true;pelletMesh.instanceMatrix.needsUpdate=true;
 for(let i=0;i<particles.length;i++){const p=particles[i];if(p.life>0&&active){p.life-=dt;p.vy-=8*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;}dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,0,0);dummy.scale.setScalar(p.life>0?p.size*Math.min(1,p.life*4):0);dummy.updateMatrix();particleMesh.setMatrixAt(i,dummy.matrix);particleMesh.setColorAt(i,p.color);}particleMesh.instanceMatrix.needsUpdate=true;if(particleMesh.instanceColor)particleMesh.instanceColor.needsUpdate=true;
 butterflies.forEach(({g,wings,phase})=>{g.position.set(Math.sin(time*.22+phase)*12,2.2+Math.sin(time*.9+phase)*.6,Math.cos(time*.17+phase)*13);g.rotation.y=-time*.22-phase;wings.forEach((w,i)=>w.rotation.z=Math.sin(time*15+phase)*(i===0?1:-1));});
 pollen.rotation.y=time*.006;nestRing.material.emissiveIntensity=.35+Math.sin(time*2)*.17;beacon.material.opacity=Rogue.ready(state)?.17:.07;homeLabel.position.y=4+Math.sin(time*1.7)*.12;
 mushrooms.forEach(m=>{m.g.scale.y=m.cooldown>0?1-Math.sin(m.cooldown*15)*.13:1;});
 if(isHome){const mobile=innerWidth<760;camTarget.set(mobile?15:12,mobile?17:12.5,mobile?25:21);lookTarget.set(mobile?-1:-5.2,0,mobile?3.5:3.0);if(innerWidth/innerHeight>1.6){camTarget.set(10.5,10.5,18.5);lookTarget.set(-4.1,0,3);}}
 else{const zoom=innerWidth<700?1.25:1;camTarget.set(state.x+10*zoom,state.y*.25+15.5*zoom,state.z+18*zoom);lookTarget.set(state.x,state.y*.2,state.z-1.4);}
 camera.position.lerp(camTarget,1-Math.exp(-dt*(isHome?2:4)));look.lerp(lookTarget,1-Math.exp(-dt*5));camera.lookAt(look);
 sun.position.set(state.x-14,25,state.z+12);sun.target.position.set(state.x,0,state.z);
 renderer.render(scene,camera);
}
requestAnimationFrame(render);
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
addEventListener('resize',resize);
addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='Escape'&&!e.repeat){if(!$('abandonModal').classList.contains('hidden'))$('abandonCancel').click();else if(state.mode==='camp')$('campClose').click();else if(!ui.helpModal.classList.contains('hidden'))ui.helpModal.classList.add('hidden');else pause();}if(e.code==='KeyE'&&!e.repeat)expedition.deliver();if(e.code==='Space'&&!e.repeat)jump();keys.add(e.code);});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{keys.clear();if(state.mode==='playing')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')pause();});
ui.startBtn.onclick=start;ui.againBtn.onclick=start;ui.restartBtn.onclick=start;ui.pauseBtn.onclick=pause;ui.resumeBtn.onclick=pause;
ui.homeBtn.onclick=()=>{setMode('home');ui.toast.classList.add('hidden');};
ui.helpBtn.onclick=()=>{ui.helpModal.classList.remove('hidden');ui.helpClose.focus();};ui.helpClose.onclick=()=>{ui.helpModal.classList.add('hidden');ui.helpBtn.focus();};
ui.helpModal.onclick=e=>{if(e.target===ui.helpModal)ui.helpClose.click();};
ui.soundBtn.textContent='声音 · 开';ui.qualityBtn.textContent='画质 · 高';ui.pauseBtn.textContent='暂停 Ⅱ';ui.pauseBtn.disabled=true;
ui.soundBtn.onclick=()=>{initAudio();state.sound=!state.sound;if(master)master.gain.setTargetAtTime(state.sound?.16:0,audioContext.currentTime,.03);ui.soundBtn.textContent='声音 · '+(state.sound?'开':'关');ui.soundBtn.setAttribute('aria-pressed',String(state.sound));sfx('click');};
ui.qualityBtn.onclick=()=>{state.quality=!state.quality;renderer.setPixelRatio(state.quality?Math.min(devicePixelRatio,1.75):1);renderer.shadowMap.enabled=state.quality;scene.traverse(o=>{if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true);}});ui.qualityBtn.textContent='画质 · '+(state.quality?'高':'省电');toast(state.quality?'高画质：柔和阴影已开启。':'省电模式：降低渲染负载。',1600);};
let joyPointer=null;
function updateStick(e){const rect=ui.joystick.getBoundingClientRect(),dx=e.clientX-(rect.left+rect.width/2),dy=e.clientY-(rect.top+rect.height/2),max=rect.width*.3,len=Math.hypot(dx,dy),ratio=len>max?max/len:1;touch.x=dx*ratio/max;touch.y=dy*ratio/max;ui.stick.style.transform=`translate(${dx*ratio}px,${dy*ratio}px)`;}
ui.joystick.onpointerdown=e=>{joyPointer=e.pointerId;ui.joystick.setPointerCapture(e.pointerId);updateStick(e);};ui.joystick.onpointermove=e=>{if(e.pointerId===joyPointer)updateStick(e);};
function resetStick(){joyPointer=null;touch.x=touch.y=0;ui.stick.style.transform='translate(0px,0px)';}
ui.joystick.onpointerup=resetStick;ui.joystick.onpointercancel=resetStick;ui.joystick.onlostpointercapture=resetStick;
ui.dashBtn.onpointerdown=e=>{touch.dash=true;ui.dashBtn.classList.add('is-active');ui.dashBtn.setPointerCapture(e.pointerId);};const stopDash=()=>{touch.dash=false;ui.dashBtn.classList.remove('is-active');};ui.dashBtn.onpointerup=stopDash;ui.dashBtn.onpointercancel=stopDash;ui.dashBtn.onlostpointercapture=stopDash;
ui.jumpBtn.onpointerdown=e=>{e.preventDefault();jump();ui.jumpBtn.classList.add('is-active');};ui.jumpBtn.onpointerup=()=>ui.jumpBtn.classList.remove('is-active');ui.jumpBtn.onpointercancel=ui.jumpBtn.onpointerup;
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(state.mode==='playing')pause();toast('图形设备暂时失去连接，请刷新页面恢复。',15000);});
expedition=createExpedition({state,ui,setMode,toast,sfx,updateHUD,burst,restart:start});
addEventListener('balancechange',()=>{createPickups();birdCircle.visible=birdShadow.visible=false;updateHUD();});
// Prevent navigation from silently abandoning a live expedition.
document.querySelector('.brand').onclick=e=>{e.preventDefault();if(expedition.meta.activeRun){if(state.mode==='playing')pause();toast('远征尚未结束，可在暂停菜单安全撤离或确认放弃。');}else{setMode('home');expedition.renderMeta();}};
// Explicit opt-in diagnostics only, for deterministic end-to-end regression tests.
if(new URLSearchParams(location.search).has('test'))window.__game={state,pickups,enemies,nest,start,simulate,updateHUD,jump,finish,renderer,scene,camera,expedition,Rogue,Config,setMode,keys};

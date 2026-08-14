// Ported from the forest.html prototype (M1). LUL-17 (M2a) gave it a real
// init()/dispose() lifecycle so it can survive React StrictMode's double-invoked
// effects: everything that was module-scope state now lives inside init()'s
// closure, every addEventListener/setTimeout is tracked via on()/later() so
// dispose() can undo it, and dispose() walks the scene graph to release Three
// resources (geometries, materials, textures) plus the renderer/AudioContext.
// Keeps the global THREE contract: LUL-15 moved Three to npm, and
// components/GameCanvas.tsx assigns the import to window.THREE before this
// script loads, so this file is unchanged from the earlier runtime-CDN setup.
(function () {
'use strict';

let activeDispose = null;

function init() {
  if (activeDispose) return;   // already running; init() is idempotent

  const cleanupFns = [];
  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanupFns.push(function () { target.removeEventListener(type, handler, opts); });
  }
  const timers = [];
  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

// ---- Knobs ---------------------------------------------------------------
const CONFIG = {
  seed:    20260718,
  mapSize: 240,          // the forest is a fixed square this many units across
  trees:   1300,
  walk:    6,            // walking speed (units/s); Shift multiplies it
  fog:     0.04,
  eye:     2.2,          // eye height
  bg:      0x0a0e15,
  trunk:   0x171b20,
  foliage: 0x102420,
  ground:  0x0c1117,
  lake:    { x: 34, z: -28, r: 15, clear: 22, glow: 0x86b8ff },
};
const half = CONFIG.mapSize / 2;
const margin = 4;

// ---- Seeded RNG (so a given map is a real, repeatable place) --------------
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
let rng = mulberry32(CONFIG.seed);
const rnd = (a=1,b) => b===undefined ? rng()*a : a + rng()*(b-a);
const clamp = (v,a,b) => v<a ? a : v>b ? b : v;

// ---- Scene / camera / renderer -------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bg);
scene.fog = new THREE.FogExp2(0x0b1220, CONFIG.fog);

const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';
camera.position.set(0, CONFIG.eye, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x8fa8c8, 0x0a0d12, 0.55));
const moon = new THREE.DirectionalLight(0xbcd0ff, 0.5); moon.position.set(-6, 16, -4); scene.add(moon);
const rim = new THREE.DirectionalLight(0x24344f, 0.4); rim.position.set(4, 5, 9); scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ color: CONFIG.ground, roughness: 1, metalness: 0 }));
ground.rotation.x = -Math.PI/2; scene.add(ground);

// ---- Night sky: gradient backdrop, stars, moon; soft fill on the player ---
(function(){
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0.0, '#05070d'); grd.addColorStop(0.55, '#080e18'); grd.addColorStop(1.0, '#0b1220');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; scene.background = tex;
})();
const STAR = 700, starArr = new Float32Array(STAR*3);
for(let i=0;i<STAR;i++){ const th = Math.random()*Math.PI*2, y = Math.random()*0.9 + 0.05, s = Math.sqrt(1-y*y), r = 300;
  starArr[i*3] = r*s*Math.cos(th); starArr[i*3+1] = r*y; starArr[i*3+2] = r*s*Math.sin(th); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starArr, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.15,
  sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
scene.add(stars);
const moonDir = new THREE.Vector3(-6, 16, -4).normalize();
const moonGroup = new THREE.Group();
moonGroup.add(
  new THREE.Mesh(new THREE.CircleGeometry(34, 32), new THREE.MeshBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
  new THREE.Mesh(new THREE.CircleGeometry(15, 40), new THREE.MeshBasicMaterial({ color: 0xeef3ff, fog: false }))
);
scene.add(moonGroup);
const playerLight = new THREE.PointLight(0x33456a, 0.7, 20, 2); camera.add(playerLight);

// ---- Trees: one instanced "master tree", positions fixed per map ---------
const trunkGeo = new THREE.CylinderGeometry(0.12, 0.20, 1.6, 6); trunkGeo.translate(0, 0.8, 0);
const cone1Geo = new THREE.ConeGeometry(1.15, 2.5, 7);           cone1Geo.translate(0, 2.1, 0);
const cone2Geo = new THREE.ConeGeometry(0.78, 1.9, 7);           cone2Geo.translate(0, 3.35, 0);
const trunkMat   = new THREE.MeshStandardMaterial({ color: CONFIG.trunk,   roughness: 1 });
const foliageMat = new THREE.MeshStandardMaterial({ color: CONFIG.foliage, roughness: 1 });

const parts = [
  new THREE.InstancedMesh(trunkGeo, trunkMat,   CONFIG.trees),
  new THREE.InstancedMesh(cone1Geo, foliageMat, CONFIG.trees),
  new THREE.InstancedMesh(cone2Geo, foliageMat, CONFIG.trees),
];
parts.forEach(p => { p.frustumCulled = false; scene.add(p); });

const dummy = new THREE.Object3D();
const tintCol = new THREE.Color();
let treeData = [];            // {x,z,s,cr}
const CELL = 8;
let grid = new Map();

function inLake(x,z){ const dx=x-CONFIG.lake.x, dz=z-CONFIG.lake.z; return dx*dx+dz*dz < CONFIG.lake.clear**2; }
function inSpawn(x,z){ return x*x+z*z < 40; }
function key(cx,cz){ return cx+','+cz; }

function buildGrid(){
  grid = new Map();
  for(const t of treeData){
    const k = key(Math.floor(t.x/CELL), Math.floor(t.z/CELL));
    (grid.get(k) || grid.set(k, []).get(k)).push(t);
  }
}
function blockedR(x,z,pr){
  const cx=Math.floor(x/CELL), cz=Math.floor(z/CELL);
  for(let gx=cx-1; gx<=cx+1; gx++) for(let gz=cz-1; gz<=cz+1; gz++){
    const arr = grid.get(key(gx,gz)); if(!arr) continue;
    for(const t of arr){ const dx=x-t.x, dz=z-t.z, rr=t.cr+pr; if(dx*dx+dz*dz < rr*rr) return true; }
  }
  return false;
}
function blocked(x,z){ return blockedR(x,z,0.6); }

function generateMap(seed){
  rng = mulberry32(seed >>> 0);

  // place the child far across the map (the "other side"), clear of the pool
  do {
    const ang = rng()*Math.PI*2, d = half*(0.5 + rng()*0.3);
    baby.x = Math.cos(ang)*d; baby.z = Math.sin(ang)*d;
  } while(inLake(baby.x, baby.z));
  baby.taken = false;
  babyGroup.visible = true;
  babyGroup.position.set(baby.x, 0, baby.z);
  placeBabyWisps();

  treeData = [];
  let tries = 0;
  while(treeData.length < CONFIG.trees && tries < CONFIG.trees*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(inLake(x,z) || inSpawn(x,z) || inBaby(x,z)) continue;
    const s = 0.7 + rng()*1.7;
    treeData.push({ x, z, s, cr: 0.35*s });
  }
  for(let i=0; i<CONFIG.trees; i++){
    if(i < treeData.length){
      const t = treeData[i];
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, rng()*Math.PI*2, 0);
      dummy.scale.setScalar(t.s);
    } else { dummy.position.set(0, -999, 0); dummy.scale.setScalar(0.0001); dummy.rotation.set(0,0,0); }
    dummy.updateMatrix();
    for(const p of parts) p.setMatrixAt(i, dummy.matrix);
    const b = i < treeData.length ? 0.72 + rng()*0.5 : 1;      // per-tree brightness variation
    tintCol.setRGB(b*0.92, b, b*0.86);
    parts[1].setColorAt(i, tintCol); parts[2].setColorAt(i, tintCol);
  }
  for(const p of parts) p.instanceMatrix.needsUpdate = true;
  if(parts[1].instanceColor) parts[1].instanceColor.needsUpdate = true;
  if(parts[2].instanceColor) parts[2].instanceColor.needsUpdate = true;
  buildGrid();
  drawMinimapStatic();
  player.x = 0; player.z = 0; player.yaw = 0; player.pitch = -0.02;
  placePredators();
}

// ---- Lake landmark (the thing to find) -----------------------------------
const water = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.lake.r, 48),
  new THREE.MeshStandardMaterial({ color: 0x0a1a2c, roughness: 0.35, metalness: 0.15 }));
water.rotation.x = -Math.PI/2; water.position.set(CONFIG.lake.x, 0.02, CONFIG.lake.z); scene.add(water);

const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.lake.r*0.72, CONFIG.lake.r*1.05, 48),
  new THREE.MeshBasicMaterial({ color: CONFIG.lake.glow, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI/2; ring.position.set(CONFIG.lake.x, 0.06, CONFIG.lake.z); scene.add(ring);

const lakeLight = new THREE.PointLight(CONFIG.lake.glow, 1.3, 75, 2);
lakeLight.position.set(CONFIG.lake.x, 7, CONFIG.lake.z); scene.add(lakeLight);

const LW = 50, lwArr = new Float32Array(LW*3);
for(let i=0;i<LW;i++){ const a=Math.random()*Math.PI*2, r=Math.random()*CONFIG.lake.r*0.95;
  lwArr[i*3]=CONFIG.lake.x+Math.cos(a)*r; lwArr[i*3+1]=0.3+Math.random()*4; lwArr[i*3+2]=CONFIG.lake.z+Math.sin(a)*r; }
const lwGeo = new THREE.BufferGeometry(); lwGeo.setAttribute('position', new THREE.BufferAttribute(lwArr,3));
const lwisps = new THREE.Points(lwGeo, new THREE.PointsMaterial({ color: CONFIG.lake.glow, size: 0.17,
  transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
lwisps.frustumCulled = false; scene.add(lwisps);

// ---- Ambient dust that drifts around you ---------------------------------
const DUST = 350, dustArr = new Float32Array(DUST*3);
for(let i=0;i<DUST;i++){ dustArr[i*3]=(Math.random()*2-1)*30; dustArr[i*3+1]=Math.random()*12; dustArr[i*3+2]=(Math.random()*2-1)*30-3; }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustArr,3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xa8c2e8, size: 0.06,
  transparent: true, opacity: 0.5, depthWrite: false }));
dust.frustumCulled = false; scene.add(dust);

// ---- The lost child (the objective) --------------------------------------
const baby = { x: 60, z: 60, taken: false };
function inBaby(x,z){ const dx=x-baby.x, dz=z-baby.z; return dx*dx+dz*dz < 20; }   // ~4.5-unit clearing

const babyGroup = new THREE.Group();
const WARM = 0xffd9b0;
const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xf3d3c0, emissive: 0xffcaa0, emissiveIntensity: 0.5, roughness: 0.85 }));
bundle.scale.set(1, 0.8, 1); bundle.position.y = 0.42;
const babyHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xf7e2d4, emissive: 0xffd6b4, emissiveIntensity: 0.5, roughness: 0.85 }));
babyHead.position.y = 0.8;
const halo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12),
  new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }));
halo.position.y = 0.55;
const babyLight = new THREE.PointLight(WARM, 1.1, 28, 2); babyLight.position.set(0, 1.3, 0);
babyGroup.add(bundle, babyHead, halo, babyLight);
scene.add(babyGroup);

// warm beacon wisps so it can be spotted through the fog
const BW = 26, bwArr = new Float32Array(BW*3);
const bwisps = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: WARM, size: 0.14, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
bwisps.geometry.setAttribute('position', new THREE.BufferAttribute(bwArr, 3));
bwisps.frustumCulled = false; scene.add(bwisps);
function placeBabyWisps(){
  for(let i=0;i<BW;i++){ const a=Math.random()*Math.PI*2, r=Math.random()*1.2;
    bwArr[i*3]=baby.x+Math.cos(a)*r; bwArr[i*3+1]=0.2+Math.random()*3.2; bwArr[i*3+2]=baby.z+Math.sin(a)*r; }
  bwisps.geometry.attributes.position.needsUpdate = true;
}

// ---- First-person arms (only shown during the pickup cinematic) ----------
scene.add(camera);
const armsGroup = new THREE.Group(); armsGroup.visible = false; camera.add(armsGroup);
const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a884, emissive: 0x3a241a, emissiveIntensity: 0.6, roughness: 0.75 });
function makeArm(){
  const arm = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 8), skinMat); fore.position.y = 0.45;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skinMat); hand.position.y = 0.95; hand.scale.set(1, 0.8, 1.15);
  arm.add(fore, hand); return arm;
}
const armL = makeArm(), armR = makeArm(); armsGroup.add(armL, armR);

// ---- Sky burst for the win (fires after the child ascends) ----------------
const flashEl = document.getElementById('flash');
const boomGroup = new THREE.Group(); boomGroup.visible = false; scene.add(boomGroup);
const boomFlash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
const boomRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 44),
  new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
boomRing.rotation.x = Math.PI/2;
const BSP = 70, bspArr = new Float32Array(BSP*3), bspVel = [];
const bspPts = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0xffe6b0, size: 0.7, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
bspPts.geometry.setAttribute('position', new THREE.BufferAttribute(bspArr, 3));
boomGroup.add(boomFlash, boomRing, bspPts);
let boomStart = -1;
function fireBoom(x, y, z){
  boomGroup.position.set(x, y, z); boomGroup.visible = true; boomStart = 0;
  for(let i=0;i<BSP;i++){ const a=Math.random()*Math.PI*2, e=Math.acos(2*Math.random()-1), sp=8+Math.random()*24;
    bspVel[i]=[Math.sin(e)*Math.cos(a)*sp, Math.cos(e)*sp, Math.sin(e)*Math.sin(a)*sp];
    bspArr[i*3]=bspArr[i*3+1]=bspArr[i*3+2]=0; }
  bspPts.geometry.attributes.position.needsUpdate = true;
  if(audio) boom(audio.ctx.currentTime);
  if(flashEl) flashEl.style.opacity = '0.9';
}
function updateBoom(dt){
  if(boomStart < 0) return;
  boomStart += dt; const e = boomStart;
  boomFlash.scale.setScalar(1 + e*11); boomFlash.material.opacity = Math.max(0, 1 - e/0.4);
  const rs = 1 + e*42; boomRing.scale.set(rs, rs, rs); boomRing.material.opacity = Math.max(0, 1 - e/1.4);
  const bp = bspPts.geometry.attributes.position.array;
  for(let i=0;i<BSP;i++){ bp[i*3]+=bspVel[i][0]*dt; bp[i*3+1]+=bspVel[i][1]*dt - 4*dt*e; bp[i*3+2]+=bspVel[i][2]*dt; }
  bspPts.geometry.attributes.position.needsUpdate = true;
  bspPts.material.opacity = Math.max(0, 1 - e/1.6);
  if(flashEl) flashEl.style.opacity = String(Math.max(0, 0.9 - e*3.5));
  if(e > 1.8){ boomGroup.visible = false; boomStart = -1; }
}
const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion();
function key3(time, keys){   // smoothstep-interpolated keyframes
  if(time <= keys[0][0]) return keys[0][1];
  for(let i=1;i<keys.length;i++){ if(time <= keys[i][0]){
    const [t0,v0]=keys[i-1], [t1,v1]=keys[i], u=(time-t0)/(t1-t0); return v0+(v1-v0)*(u*u*(3-2*u)); } }
  return keys[keys.length-1][1];
}

// (The death "getting eaten" moment is now a separate 2D cutscene overlay, not 3D geometry.)

// ---- Predators: wolf, bear, lion -----------------------------------------
const PSPEC = {
  wolf: { body:0x565b63, sz:1.0, len:1.6, h:0.9,  mane:false, ears:true,  speed:8.5, detect:42, eye:0xffd23a, rad:0.8, budget:6 },
  bear: { body:0x3d2c22, sz:1.8, len:2.0, h:1.45, mane:false, ears:false, speed:6.8, detect:30, eye:0xff5a2a, rad:1.5, budget:9 },
  lion: { body:0xc79a5b, sz:1.2, len:1.7, h:1.0,  mane:true,  ears:true,  speed:9.2, detect:48, eye:0xffcf3a, rad:1.0, budget:4 },
};
// Size each animal's speed from its warning budget: from the moment it SEES you and you
// flee at top speed, the fastest (lion) still gives ≥4s, the bear ≥9s. All are faster than
// the player, so you can't simply outrun them — hiding is the real escape. Tune via CHASE_GAP.
const RUN = CONFIG.walk * 1.8, CHASE_GAP = 28;
for(const k in PSPEC) PSPEC[k].speed = RUN + CHASE_GAP / PSPEC[k].budget;
function makePredator(kind){
  const s = PSPEC[kind], g = new THREE.Group();
  const H = s.h, L = s.len, Wd = s.sz, bodyY = H*0.62;
  const skin = new THREE.MeshStandardMaterial({ color: s.body, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.body).multiplyScalar(0.7), roughness: 0.95 });
  const furMat = new THREE.MeshStandardMaterial({ color: 0x6e4a24, roughness: 1 });

  // torso: chest + midriff + haunch, overlapping and tapered
  const torso = new THREE.Group(); torso.position.y = bodyY; g.add(torso);
  const chest  = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), skin); chest.scale.set(Wd*0.9, H*0.5, L*0.5);  chest.position.set(0, 0.02*H, L*0.34);
  const midrib = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), skin); midrib.scale.set(Wd*0.82, H*0.46, L*0.55);
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), skin); haunch.scale.set(Wd*0.95, H*0.52, L*0.5); haunch.position.set(0, 0.02*H, -L*0.32);
  torso.add(chest, midrib, haunch);

  // neck + head with a snout
  const neck = new THREE.Group(); neck.position.set(0, bodyY + H*0.12, L*0.5); g.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14*Wd, 0.2*Wd, 0.4*H, 9), skin);
  neckMesh.position.y = 0.2*H; neckMesh.rotation.x = 0.5; neck.add(neckMesh);
  const head = new THREE.Group(); head.position.set(0, 0.34*H, 0.16*L); neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24*Wd, 12, 10), skin); skull.scale.set(1, 0.95, 1.1); head.add(skull);
  const snoutLen = 0.34*Wd*(kind==='bear' ? 0.85 : 1.4);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.1*Wd, 0.16*Wd, snoutLen, 8), skin);
  snout.rotation.x = Math.PI/2; snout.position.set(0, -0.03*Wd, 0.18*Wd + snoutLen*0.4); head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055*Wd, 8, 6), dark);
  nose.position.set(0, -0.02*Wd, 0.18*Wd + snoutLen*0.9); head.add(nose);
  if(s.ears) [-1,1].forEach(d => { const ear=new THREE.Mesh(new THREE.ConeGeometry(0.08*Wd, 0.2*Wd, 5), skin); ear.position.set(0.12*Wd*d, 0.2*Wd, -0.02*Wd); head.add(ear); });
  else       [-1,1].forEach(d => { const ear=new THREE.Mesh(new THREE.SphereGeometry(0.07*Wd, 8, 6), skin);      ear.position.set(0.15*Wd*d, 0.19*Wd, -0.03*Wd); head.add(ear); });
  if(s.mane){ const n=12; for(let i=0;i<n;i++){ const a=i/n*Math.PI*2; const m=new THREE.Mesh(new THREE.SphereGeometry(0.12*Wd, 7, 6), furMat);
    m.position.set(Math.cos(a)*0.26*Wd, Math.sin(a)*0.26*Wd, -0.08*Wd); head.add(m); } }
  const eyeMat = new THREE.MeshBasicMaterial({ color: s.eye });
  [-1,1].forEach(d => { const e=new THREE.Mesh(new THREE.SphereGeometry(0.05*Wd, 8, 6), eyeMat); e.position.set(0.1*Wd*d, 0.03*Wd, 0.16*Wd); head.add(e); });

  // legs: hip → thigh, knee → shin + paw (so they can bend)
  const legs = [];
  for(const [lx, lz, fr] of [[Wd*0.34, L*0.42, 1], [-Wd*0.34, L*0.42, 1], [Wd*0.34, -L*0.4, -1], [-Wd*0.34, -L*0.4, -1]]){
    const hip = new THREE.Group(); hip.position.set(lx, bodyY, lz); g.add(hip);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075*Wd, 0.06*Wd, bodyY*0.5, 7), dark); thigh.position.y = -bodyY*0.25; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -bodyY*0.5; hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055*Wd, 0.045*Wd, bodyY*0.45, 7), dark); shin.position.y = -bodyY*0.225; knee.add(shin);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.07*Wd, 8, 6), dark); paw.scale.set(1, 0.6, 1.35); paw.position.y = -bodyY*0.45; knee.add(paw);
    legs.push({ hip, knee, fr });
  }

  // tail (two segments so it can sway)
  const tail = new THREE.Group(); tail.position.set(0, bodyY + 0.04*H, -L*0.5); tail.rotation.x = 0.6; g.add(tail);
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05*Wd, 0.03*Wd, 0.34*L, 6), skin); t1.position.y = -0.17*L; tail.add(t1);
  const tail2 = new THREE.Group(); tail2.position.y = -0.34*L; tail.add(tail2);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03*Wd, 0.015*Wd, 0.3*L, 6), skin); t2.position.y = -0.15*L; tail2.add(t2);
  if(s.mane){ const tuft=new THREE.Mesh(new THREE.SphereGeometry(0.09*Wd, 7, 6), furMat); tuft.position.y = -0.3*L; tail2.add(tuft); }

  scene.add(g);
  return { g, kind, spec:s, legs, neck, head, torso, tail, tail2, rad:s.rad,
    state:'roam', x:0, z:0, vx:0, vz:0, yaw:0, wpx:0, wpz:0,
    phase:Math.random()*6, spotted:false, callTimer:0,
    inv:'', sniffsLeft:0, sniffTimer:0, backX:0, backZ:0,
    stuckT:0, trail:[], trailT:0, reroute:0, rrX:0, rrZ:0, hunt:false, alert:0 };
}
const predators = [];
for(const k of ['wolf','bear','lion']) for(let i=0;i<3;i++) predators.push(makePredator(k));
let sinceClose = 0, huntTime = 0, spotFlash = 0, pianoTimer = 0;   // threat timers, spot flash, approach-note timer
function placePredators(){
  for(const p of predators){
    let x, z, tries = 0;
    do { const ang=rng()*Math.PI*2, d=half*(0.42+rng()*0.45); x=Math.cos(ang)*d; z=Math.sin(ang)*d; tries++; }
    while((x*x+z*z < 2500 || Math.hypot(x-baby.x, z-baby.z) < 26 || blockedR(x, z, p.rad+0.5)) && tries < 60);
    p.x=x; p.z=z; p.wpx=x; p.wpz=z; p.vx=0; p.vz=0; p.yaw=rng()*Math.PI*2;
    p.state='roam'; p.spotted=false; p.inv=''; p.sniffsLeft=0; p.sniffTimer=0; p.callTimer=0;
    p.stuckT=0; p.trail=[]; p.trailT=0; p.reroute=0; p.hunt=false; p.alert=0;
    p.g.position.set(x, 0, z); p.g.rotation.set(0, p.yaw, 0);
  }
  sinceClose = 0; huntTime = 0; spotFlash = 0;
}
// steer a desired direction around trees the predator would otherwise walk into
function avoidDir(p, dx, dz){
  const look = p.rad + 2.4;
  if(!blockedR(p.x + dx*look, p.z + dz*look, p.rad)) return [dx, dz];
  for(const ang of [0.5,-0.5,1.0,-1.0,1.6,-1.6,2.2,-2.2]){
    const c=Math.cos(ang), s=Math.sin(ang), rx=dx*c-dz*s, rz=dx*s+dz*c;
    if(!blockedR(p.x + rx*look, p.z + rz*look, p.rad)) return [rx, rz];
  }
  return [dx, dz];
}
function updatePredators(dt){
  const tt = clock.elapsedTime;
  for(const p of predators){
    const dx = player.x - p.x, dz = player.z - p.z, dist = Math.hypot(dx, dz) || 0.0001;
    const ux = dx/dist, uz = dz/dist;
    let desx = 0, desz = 0, speed = 0, facePlayer = false;

    // spot "alert": brief rear-up + freeze the instant it locks on
    if(p.alert > 0){
      p.alert -= dt; facePlayer = true; speed = 0;
      // (movement handled below; the rear is applied in the animation section)
    } else if(p.reroute > 0){                        // stuck → back up along its trail, then a different way
      p.reroute -= dt;
      const bx=p.rrX-p.x, bz=p.rrZ-p.z, bd=Math.hypot(bx,bz);
      if(bd > 0.4){ desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.7; }
      if(p.reroute <= 0) p.stuckT = 0;
    } else if(p.hunt && !hidden){                    // forced: comes straight for you (no giving up)
      if(dist < p.rad + 1.3) triggerDeath(p.kind);
      else { desx=ux; desz=uz; speed=p.spec.speed; }
      if(dist < 8) p.hunt = false;                   // reached you → back to normal
      if(hidden) { p.state='investigate'; p.inv='approach'; p.sniffsLeft=1+Math.floor(Math.random()*4); p.hunt=false; }
      p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind); p.callTimer = rnd(2.6,4.6); }
    } else if(p.state === 'roam'){
      if(!hidden && dist < p.spec.detect){ spotOnto(p); }
      else {
        let wx=p.wpx-p.x, wz=p.wpz-p.z; const wd=Math.hypot(wx,wz);
        if(wd < 2.5){ const a=Math.random()*Math.PI*2, r=15+Math.random()*40;
          p.wpx=clamp(p.x+Math.cos(a)*r,-half+4,half-4); p.wpz=clamp(p.z+Math.sin(a)*r,-half+4,half-4); }
        else { desx=wx/wd; desz=wz/wd; speed=2.3; }
      }
    } else if(p.state === 'chase'){
      if(hidden){ p.state='investigate'; p.inv='approach'; p.sniffsLeft = 1 + Math.floor(Math.random()*4); }
      else {
        if(dist < p.rad + 1.3){ triggerDeath(p.kind); }
        else { desx=ux; desz=uz; speed=p.spec.speed; }
        if(dist > p.spec.detect*1.5){ p.state='roam'; p.spotted=false; }
        p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind); p.callTimer = rnd(2.6,4.6); }
      }
    } else if(p.state === 'investigate'){
      if(!hidden){ p.state='chase'; }
      else if(p.inv === 'approach'){
        facePlayer = true;
        if(dist < p.rad + 1.7){ p.inv='sniff'; p.sniffTimer = rnd(1,5); sniff(); }
        else { desx=ux; desz=uz; speed=p.spec.speed*0.45; }
      } else if(p.inv === 'sniff'){
        facePlayer = true; p.sniffTimer -= dt;
        if(p.sniffTimer <= 0){
          p.sniffsLeft--;
          if(p.sniffsLeft > 0){ p.inv='back'; const bd = 8 + Math.random()*8;
            p.backX = clamp(p.x - ux*bd, -half+4, half-4); p.backZ = clamp(p.z - uz*bd, -half+4, half-4); }
          else { p.state='roam'; p.spotted=false; }
        }
      } else if(p.inv === 'back'){
        const bx=p.backX-p.x, bz=p.backZ-p.z, bd=Math.hypot(bx,bz);
        if(bd < 2){ p.inv='approach'; } else { desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.5; }
      }
    }

    if(speed > 0 && (desx || desz)) [desx, desz] = avoidDir(p, desx, desz);

    // smooth velocity + collide with trees (axis-separated slide)
    const dvx = desx*speed, dvz = desz*speed, accel = speed > 0 ? 3.6 : 6;
    p.vx += (dvx - p.vx) * Math.min(1, dt*accel);
    p.vz += (dvz - p.vz) * Math.min(1, dt*accel);
    const px0 = p.x, pz0 = p.z;
    const nx = clamp(p.x + p.vx*dt, -half+2, half-2), nz = clamp(p.z + p.vz*dt, -half+2, half-2);
    if(!blockedR(nx, p.z, p.rad)) p.x = nx; else p.vx *= 0.2;
    if(!blockedR(p.x, nz, p.rad)) p.z = nz; else p.vz *= 0.2;
    p.g.position.x = p.x; p.g.position.z = p.z;

    // trail + stuck detection (only while it actually wants to move)
    p.trailT -= dt;
    if(p.trailT <= 0){ p.trailT = 0.4; p.trail.push([p.x, p.z]); if(p.trail.length > 6) p.trail.shift(); }
    const moved = Math.hypot(p.x - px0, p.z - pz0);
    if(speed > 1 && p.reroute <= 0 && p.alert <= 0){
      if(moved < speed*dt*0.35) p.stuckT += dt; else p.stuckT = Math.max(0, p.stuckT - dt*2);
      if(p.stuckT > 3){                              // go back along the trail, then a different way
        const back = p.trail[0] || [p.x - ux*6, p.z - uz*6];
        p.rrX = back[0]; p.rrZ = back[1]; p.reroute = 1.4; p.stuckT = 0;
        p.wpx = clamp(p.x + (Math.random()-0.5)*40, -half+4, half-4);   // fresh, different waypoint
        p.wpz = clamp(p.z + (Math.random()-0.5)*40, -half+4, half-4);
      }
    }

    // smooth turning (toward heading, or toward you when facing), with a lean
    const vmag = Math.hypot(p.vx, p.vz);
    let targetYaw = p.yaw;
    if(facePlayer) targetYaw = Math.atan2(ux, uz);
    else if(vmag > 0.3) targetYaw = Math.atan2(p.vx, p.vz);
    let d = targetYaw - p.yaw; while(d > Math.PI) d -= 2*Math.PI; while(d < -Math.PI) d += 2*Math.PI;
    p.yaw += d * Math.min(1, dt*7);
    p.g.rotation.y = p.yaw;

    // ---- articulated animation ----
    const moving = vmag > 0.3;
    p.phase += dt * (moving ? vmag*0.9 : 1.4);
    const sniffing = p.state==='investigate' && p.inv==='sniff';
    const alerting = p.alert > 0;
    // legs: diagonal gait (bend the knee on the forward swing)
    for(let i=0;i<p.legs.length;i++){
      const ph = p.phase + ((i===0||i===3) ? 0 : Math.PI);     // diagonal pairs
      const sw = moving ? Math.sin(ph)*0.5 : 0;
      p.legs[i].hip.rotation.x += (sw - p.legs[i].hip.rotation.x) * Math.min(1, dt*12);
      p.legs[i].knee.rotation.x += ((moving ? Math.max(0, Math.sin(ph+0.6))*0.7 : 0) - p.legs[i].knee.rotation.x) * Math.min(1, dt*12);
    }
    // body bob + gallop lean, torso sway, turn-lean
    const bob = moving ? Math.sin(p.phase*2)*0.05 : Math.sin(tt*1.5)*0.01;
    p.g.position.y = bob;
    p.torso.rotation.z += ((moving ? Math.sin(p.phase)*0.05 : 0) - p.torso.rotation.z) * Math.min(1, dt*8);
    p.g.rotation.z = clamp(-d*0.6, -0.22, 0.22);
    // neck/head: bob with gait, dip low to sniff, rear up when alerting
    const neckTarget = sniffing ? 0.9 : alerting ? -0.6 : (moving ? 0.5 + Math.sin(p.phase*2+1)*0.06 : 0.5);
    p.neck.rotation.x += (neckTarget - p.neck.rotation.x) * Math.min(1, dt*6);
    p.head.rotation.x += (((sniffing?0.5:0) + (alerting?-0.3:0)) - p.head.rotation.x) * Math.min(1, dt*6);
    // rear the whole body a touch when alerting
    p.torso.rotation.x += (((alerting?-0.18:0)) - p.torso.rotation.x) * Math.min(1, dt*8);
    // tail sway
    p.tail.rotation.z = Math.sin(tt*3 + p.phase)*0.18;
    p.tail2.rotation.z = Math.sin(tt*3 + p.phase + 0.8)*0.22;
  }
}
// lock onto the player: stinger, roar, screen flash, and a rear-up alert beat
function spotOnto(p){
  p.state='chase'; p.callTimer=rnd(2.6,4.2); p.alert = 0.55;
  if(!p.spotted){ p.spotted=true; }
  predatorCall(p.kind); spotSting(); spotFlash = 1;
}

// ---- Player + input ------------------------------------------------------
const player = { x:0, z:0, yaw:0, pitch:-0.02 };
const keys = {};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let entered = false, walk = CONFIG.walk, won = false, canPickup = false,
    dead = false, pickingUp = false, pickStart = 0, hidden = false, hideTime = 0, eyeH = CONFIG.eye,
    deathStart = 0, deathShown = false, pickBoomed = false;

on(window, 'keydown', e => {
  keys[e.code] = true;
  const playing = entered && !won && !dead && !pickingUp;
  if(e.code === 'Escape' && playing){ if(locked) document.exitPointerLock(); else setPaused(true); }
  if(e.code === 'KeyE' && canPickup && playing && !paused) pickup();
  if(e.code === 'KeyH' && playing && !paused){ hidden = !hidden; if(hidden) hideTime = 0; }
});
on(window, 'keyup', e => { keys[e.code] = false; });

// Look: free mouse-look via Pointer Lock, with click-and-drag as a fallback
let dragging = false, locked = false, paused = false;
const el = renderer.domElement;
const SENS = 0.0022;
function applyLook(dx, dy){
  player.yaw -= dx*SENS;
  player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - dy*SENS));
}
function requestLock(){ if(el.requestPointerLock) el.requestPointerLock(); }
on(document, 'pointerlockchange', () => {
  locked = document.pointerLockElement === el;
  if(locked) setPaused(false);
  else if(entered && !won && !dead && !pickingUp) setPaused(true);     // Esc / released lock -> menu
});
on(document, 'pointerlockerror', () => { locked = false; });
on(el, 'mousedown', () => {
  if(paused){ setPaused(false); requestLock(); return; }   // click to look again
  if(!locked){ dragging = true; el.style.cursor = 'grabbing'; }
});
on(window, 'mouseup', () => { dragging = false; el.style.cursor = 'default'; });
on(window, 'mousemove', e => {
  if(locked) applyLook(e.movementX, e.movementY);
  else if(dragging) applyLook(e.movementX, e.movementY);
});
let lastTouch = null;
on(renderer.domElement, 'touchstart', e => { lastTouch = e.touches[0]; }, {passive:true});
on(renderer.domElement, 'touchmove', e => {
  const t = e.touches[0];
  if(lastTouch) applyLook((t.clientX-lastTouch.clientX)*2, (t.clientY-lastTouch.clientY)*2);
  lastTouch = t;
}, {passive:true});

// ---- Procedural audio (built on first entry) -----------------------------
let audio = null, started = false, soundOn = true;
function noise(ctx, sec, brown){
  const len = Math.floor(ctx.sampleRate*sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for(let i=0;i<len;i++){ const w = Math.random()*2-1;
    if(brown){ last = (last + 0.02*w)/1.02; d[i] = Math.max(-1, Math.min(1, last*3.2)); } else d[i] = w; }
  return b;
}
function impulse(ctx, sec, decay){
  const len = Math.floor(ctx.sampleRate*sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for(let c=0;c<2;c++){ const d = b.getChannelData(c); for(let i=0;i<len;i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len, decay); }
  return b;
}
function startAudio(){
  const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
  const ctx = new AC();
  const master = ctx.createGain(); master.connect(ctx.destination);
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(soundOn ? 0.6 : 0.0001, ctx.currentTime + 2);

  const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.4, 3.0);
  const rev = ctx.createGain(); rev.gain.value = 0.5; conv.connect(rev); rev.connect(master);

  // wind bed — brown noise through a lowpass, opens up as you move
  const wind = ctx.createBufferSource(); wind.buffer = noise(ctx, 3, true); wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 340; wf.Q.value = 0.6;
  const wg = ctx.createGain(); wg.gain.value = 0.06;
  wind.connect(wf); wf.connect(wg); wg.connect(master); wg.connect(conv); wind.start();

  // low ominous drone
  const dg = ctx.createGain(); dg.gain.value = 0.05; dg.connect(master); dg.connect(conv);
  [55, 82.5, 110].forEach((f, i) => { const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
    o.detune.value=(i-1)*6; const og = ctx.createGain(); og.gain.value = i===2 ? 0.35 : 1;
    o.connect(og); og.connect(dg); o.start(); });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
  const lfg = ctx.createGain(); lfg.gain.value = 0.02; lfo.connect(lfg); lfg.connect(dg.gain); lfo.start();

  // hunt cue — dissonant + pulsing, silent until a predator gives chase
  const huntGain = ctx.createGain(); huntGain.gain.value = 0.0001; huntGain.connect(master); huntGain.connect(conv);
  const hf = ctx.createBiquadFilter(); hf.type='lowpass'; hf.frequency.value=560; hf.Q.value=1.2; hf.connect(huntGain);
  [55, 77.78, 110].forEach((f, i) => { const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f;   // tritone-ish cluster
    o.detune.value=(i-1)*9; const og=ctx.createGain(); og.gain.value = i===2 ? 0.14 : 0.2; o.connect(og); og.connect(hf); o.start(); });
  const pulse = ctx.createOscillator(); pulse.type='sine'; pulse.frequency.value=110;   // heartbeat throb
  const pulseGain = ctx.createGain(); pulseGain.gain.value=0.02; pulse.connect(pulseGain); pulseGain.connect(huntGain);
  const plfo = ctx.createOscillator(); plfo.type='sine'; plfo.frequency.value=2.7;
  const plfg = ctx.createGain(); plfg.gain.value=0.08; plfo.connect(plfg); plfg.connect(pulseGain.gain); pulse.start(); plfo.start();
  const shimmer = ctx.createOscillator(); shimmer.type='triangle'; shimmer.frequency.value=1245;   // unease up high
  const shg = ctx.createGain(); shg.gain.value=0.012; shimmer.connect(shg); shg.connect(huntGain); shimmer.start();

  audio = { ctx, master, wf, wg, dg, huntGain, plfo, conv, foot: 0, twinkle: rnd(1.5,4), footBuf: noise(ctx, 0.3, false) };
}
function footstep(vol){
  const { ctx, conv, master, footBuf } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = footBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 150 + Math.random()*100; f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
  src.connect(f); f.connect(g); g.connect(master); g.connect(conv); src.start(t); src.stop(t+0.22);
}
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 987.77];
function twinkle(vol, bright){
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const f = SCALE[Math.floor(Math.random()*SCALE.length)] * (bright ? 2 : 1);
  const o = ctx.createOscillator(); o.type='sine'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type='sine'; o2.frequency.value = f*2.001;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t+0.01); g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); g.connect(conv);
  o.start(t); o2.start(t); o.stop(t+1.7); o2.stop(t+1.7);
}
// swelling warm cue for the 10s pickup cinematic
function playPickupMusic(){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t0 = ctx.currentTime;
  audio.wg.gain.setTargetAtTime(0.015, t0, 0.6);   // duck wind + drone
  audio.dg.gain.setTargetAtTime(0.02, t0, 0.6);
  const bus = ctx.createGain(); bus.connect(master); bus.connect(conv);
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(0.55, t0 + 3.5);
  bus.gain.setValueAtTime(0.55, t0 + 7);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + 10.5);
  const chords = [[261.63,329.63,392.00],[196.00,293.66,392.00],[220.00,261.63,329.63],[174.61,261.63,349.23]];
  chords.forEach((ch, i) => {
    const s = t0 + i*2.5, e = s + 2.7;
    ch.forEach(f => {
      const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
      const o2 = ctx.createOscillator(); o2.type='triangle'; o2.frequency.value=f; o2.detune.value=5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s+0.8); g.gain.setValueAtTime(0.12, e-0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, e);
      o.connect(g); o2.connect(g); g.connect(bus);
      o.start(s); o2.start(s); o.stop(e+0.05); o2.stop(e+0.05);
    });
  });
  const rise = [392.00,440.00,523.25,587.33,659.25,783.99,880.00,1046.50];   // ascending as the child lifts
  rise.forEach((f, i) => {
    const s = t0 + 3.5 + i*0.55;
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.14, s+0.02); g.gain.exponentialRampToValueAtTime(0.0001, s+1.4);
    o.connect(g); g.connect(bus); g.connect(conv); o.start(s); o.stop(s+1.5);
  });
  later(() => { if(audio){ audio.wg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); audio.dg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); } }, 11000);
}
// distinct voice per species so you can hear what's coming
function predatorCall(kind, big){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime, vol = big ? 1.0 : 0.6;
  if(kind === 'wolf'){                              // howl: gliding tone with vibrato
    const o=ctx.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(300,t); o.frequency.linearRampToValueAtTime(560,t+0.4);
    o.frequency.setValueAtTime(560,t+0.9); o.frequency.linearRampToValueAtTime(360,t+1.5);
    const vib=ctx.createOscillator(); vib.type='sine'; vib.frequency.value=6;
    const vibg=ctx.createGain(); vibg.gain.value=16; vib.connect(vibg); vibg.connect(o.frequency); vib.start(t); vib.stop(t+1.6);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=820; bp.Q.value=1.4;
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.22*vol,t+0.15);
    g.gain.setValueAtTime(0.22*vol,t+1.1); g.gain.exponentialRampToValueAtTime(0.0001,t+1.6);
    o.connect(bp); bp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.65);
  } else if(kind === 'bear'){                       // low guttural roar + noise
    [70,96].forEach(f => { const o=ctx.createOscillator(); o.type='sawtooth';
      o.frequency.setValueAtTime(f*1.2,t); o.frequency.exponentialRampToValueAtTime(f*0.8,t+0.9);
      const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=420; lp.Q.value=4;
      const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.28*vol,t+0.1);
      g.gain.setValueAtTime(0.28*vol,t+0.7); g.gain.exponentialRampToValueAtTime(0.0001,t+1.1);
      o.connect(lp); lp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.15); });
    const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,1.0,false);
    const nf=ctx.createBiquadFilter(); nf.type='lowpass'; nf.frequency.value=520;
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0.0001,t); ng.gain.exponentialRampToValueAtTime(0.12*vol,t+0.1); ng.gain.exponentialRampToValueAtTime(0.0001,t+0.9);
    nb.connect(nf); nf.connect(ng); ng.connect(master); nb.start(t); nb.stop(t+1.0);
  } else {                                          // lion: rasping roar (fast AM + filter sweep)
    const o=ctx.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(220,t); o.frequency.exponentialRampToValueAtTime(150,t+1.1);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=3;
    lp.frequency.setValueAtTime(700,t); lp.frequency.linearRampToValueAtTime(1500,t+0.35); lp.frequency.linearRampToValueAtTime(520,t+1.1);
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.24*vol,t+0.12);
    g.gain.setValueAtTime(0.24*vol,t+0.8); g.gain.exponentialRampToValueAtTime(0.0001,t+1.2);
    const am=ctx.createOscillator(); am.type='sine'; am.frequency.value=30;
    const amg=ctx.createGain(); amg.gain.value=0.12*vol; am.connect(amg); amg.connect(g.gain); am.start(t); am.stop(t+1.25);
    o.connect(lp); lp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.25);
  }
}
// two quick snorts as it sniffs you out
function sniff(){
  if(!audio || !soundOn) return;
  const { ctx, master } = audio, t0 = ctx.currentTime;
  for(let i=0;i<2;i++){
    const t = t0 + i*0.22;
    const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,0.18,false);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=1.2;
    bp.frequency.setValueAtTime(650,t); bp.frequency.linearRampToValueAtTime(1700,t+0.12);
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.16,t+0.03); g.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
    nb.connect(bp); bp.connect(g); g.connect(master); nb.start(t); nb.stop(t+0.18);
  }
}
// the bite hit
function chomp(when){
  if(!audio || !soundOn) return;
  const { ctx, master } = audio, ct = when;
  const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,0.2,false);
  const nf=ctx.createBiquadFilter(); nf.type='bandpass'; nf.frequency.value=1800; nf.Q.value=0.8;
  const ng=ctx.createGain(); ng.gain.setValueAtTime(0.0001,ct); ng.gain.exponentialRampToValueAtTime(0.5,ct+0.006); ng.gain.exponentialRampToValueAtTime(0.0001,ct+0.14);
  nb.connect(nf); nf.connect(ng); ng.connect(master); nb.start(ct); nb.stop(ct+0.16);
  const thud=ctx.createOscillator(); thud.type='sine'; thud.frequency.setValueAtTime(120,ct); thud.frequency.exponentialRampToValueAtTime(40,ct+0.15);
  const tg=ctx.createGain(); tg.gain.setValueAtTime(0.0001,ct); tg.gain.exponentialRampToValueAtTime(0.4,ct+0.01); tg.gain.exponentialRampToValueAtTime(0.0001,ct+0.25);
  thud.connect(tg); tg.connect(master); thud.start(ct); thud.stop(ct+0.3);
}
// death: duck everything, the animal roars, then the bite lands (timed to the video)
function deathAudio(kind){
  if(!audio || !soundOn) return;
  const t = audio.ctx.currentTime;
  audio.huntGain.gain.setTargetAtTime(0.0001, t, 0.12);
  audio.wg.gain.setTargetAtTime(0.0001, t, 0.12);
  audio.dg.gain.setTargetAtTime(0.0001, t, 0.12);
  predatorCall(kind, true);
  chomp(t + 1.35);
}
// sharp stinger the instant an animal locks onto you
function spotSting(){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  [1200,1272,1900].forEach(f => { const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f;
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=f; bp.Q.value=7;
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.11,t+0.008); g.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
    o.connect(bp); bp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+0.55); });
  const lo=ctx.createOscillator(); lo.type='sine'; lo.frequency.setValueAtTime(190,t); lo.frequency.exponentialRampToValueAtTime(48,t+0.3);
  const lg=ctx.createGain(); lg.gain.setValueAtTime(0.0001,t); lg.gain.exponentialRampToValueAtTime(0.42,t+0.01); lg.gain.exponentialRampToValueAtTime(0.0001,t+0.4);
  lo.connect(lg); lg.connect(master); lo.start(t); lo.stop(t+0.45);
}
// a dissonant piano note; caller raises pitch/volume as the animal gets nearer
function pianoNote(freq, vol){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const parts = [[1,1],[2,0.5],[3,0.25],[4,0.12]];
  const play = (f, amp) => parts.forEach(([h,ha]) => { const o=ctx.createOscillator(); o.type='sine';
    o.frequency.value = f*h*(1+0.0007*h*h);
    const g=ctx.createGain(); const a=amp*ha*vol; g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(a, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
    o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.65); });
  play(freq, 0.12); play(freq*1.414, 0.05);   // + tritone shadow for dread
}
// big explosion when the child bursts into the sky
function boom(when){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = when;
  const o=ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(120,t); o.frequency.exponentialRampToValueAtTime(28,t+1.2);
  const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.6,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+1.6);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+1.7);
  const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,1.4,false);
  const nf=ctx.createBiquadFilter(); nf.type='lowpass'; nf.frequency.setValueAtTime(3000,t); nf.frequency.exponentialRampToValueAtTime(200,t+1.2);
  const ng=ctx.createGain(); ng.gain.setValueAtTime(0.0001,t); ng.gain.exponentialRampToValueAtTime(0.4,t+0.02); ng.gain.exponentialRampToValueAtTime(0.0001,t+1.5);
  nb.connect(nf); nf.connect(ng); ng.connect(master); ng.connect(conv); nb.start(t); nb.stop(t+1.5);
  [0,0.08,0.16,0.26].forEach((d,i) => { const so=ctx.createOscillator(); so.type='sine'; so.frequency.value=1200+i*400;
    const sg=ctx.createGain(); sg.gain.setValueAtTime(0.0001,t+d); sg.gain.exponentialRampToValueAtTime(0.12,t+d+0.01); sg.gain.exponentialRampToValueAtTime(0.0001,t+d+0.7);
    so.connect(sg); sg.connect(master); sg.connect(conv); so.start(t+d); so.stop(t+d+0.75); });
}

// ---- Gate + pause --------------------------------------------------------
const gate = document.getElementById('gate');
const hint = document.getElementById('hint');
const pausePrompt = document.getElementById('pausePrompt');
function setPaused(p){ paused = p; pausePrompt.style.display = p ? 'flex' : 'none'; }
function enter(){
  gate.style.display = 'none';
  entered = true;
  setPaused(false);
  if(!started){ startAudio(); started = true; }
  else if(audio){ audio.ctx.resume(); }
  requestLock();
  hint.style.opacity = '0.85';
  later(() => { hint.style.opacity = '0'; }, 5000);
}
on(gate, 'click', enter);

// QA-only, opt-in (?qaHooks=1): the procedurally generated forest can wedge a
// straight-line walk against a tree cluster near spawn depending on seed/heading,
// which makes "walk to the child" an unreliable way to test the lift/win state
// machine itself (navigation, not the mechanic, would be under test). This drops
// the player next to the child so e2e/smoke.spec.ts can assert pickup -> win
// deterministically. Absent by default, so it does nothing for real players.
// player/baby are init()-local (LUL-17 closure), so this is exposed per-init,
// same lifetime as everything else window.ForestEngine hands out.
if(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('qaHooks')){
  window.ForestEngine.qaTeleportNearBaby = function(){ player.x = baby.x + 2; player.z = baby.z; };
}

// ---- Objective, pickup cinematic, win / death ----------------------------
const objective = document.getElementById('objective');
const statusEl = document.getElementById('status');
const spotFlashEl = document.getElementById('spotFlash');
const winScreen = document.getElementById('winScreen');
const deathScreen = document.getElementById('deathScreen');
const deathText = document.getElementById('deathText');
const deathVideo = document.getElementById('deathVideo');
const CUT_END = 3.7;   // death video length; reveal the loss text at the end
if(deathVideo) on(deathVideo, 'ended', () => { if(dead) revealLoss(); });
function pickup(){
  if(baby.taken || won || dead || pickingUp) return;
  baby.taken = true; pickingUp = true; pickStart = clock.elapsedTime; hidden = false;
  objective.style.display = 'none'; statusEl.style.display = 'none';
  if(locked) document.exitPointerLock();
  document.body.style.cursor = 'none';
  armsGroup.visible = true;
  pickBoomed = false;
  playPickupMusic();
}
function finishPickup(){
  pickingUp = false; won = true;
  armsGroup.visible = false; babyGroup.visible = false;
  document.body.style.cursor = '';
  winScreen.style.display = 'flex';
}
function triggerDeath(kind){
  if(dead || won || pickingUp) return;
  dead = true; hidden = false; deathStart = clock.elapsedTime; deathShown = false;
  if(locked) document.exitPointerLock();
  document.body.style.cursor = 'none';
  document.getElementById('deathKind').textContent = kind;
  deathText.style.opacity = '0';
  deathScreen.style.background = 'rgba(0,0,0,0)';
  deathScreen.style.display = 'flex';
  playDeathVideo();
  deathAudio(kind);
}
function playDeathVideo(){
  if(!deathVideo || !deathVideo.getAttribute('src')){ revealLoss(); return; }   // no video embedded → just show text
  deathVideo.style.display = 'block';
  try { deathVideo.currentTime = 0; } catch(e){}
  const pr = deathVideo.play();
  if(pr && pr.catch) pr.catch(() => {});     // muted autoplay is allowed; ignore any rejection
}
function revealLoss(){ deathShown = true; document.body.style.cursor = ''; deathText.style.opacity = '1'; }
function restart(){
  winScreen.style.display = 'none'; deathScreen.style.display = 'none';
  if(deathVideo){ deathVideo.pause(); deathVideo.style.display = 'none'; }
  won = dead = pickingUp = hidden = false; hideTime = 0; eyeH = CONFIG.eye; deathShown = false;
  armsGroup.visible = false; babyGroup.visible = true;
  deathText.style.opacity = '0'; deathScreen.style.background = 'rgba(0,0,0,0)';
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5;
  pickBoomed = false; boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';
  document.body.style.cursor = '';
  generateMap((Math.random()*1e9) >>> 0);   // fresh forest, child, and predators
  enter();
}
document.querySelectorAll('.restartBtn').forEach(b => on(b, 'click', restart));

// ---- Controls ------------------------------------------------------------
const paceEl = document.getElementById('pace'), fogEl = document.getElementById('fog');
on(paceEl, 'input', e => { walk = +e.target.value; document.getElementById('paceVal').textContent = walk; });
on(fogEl, 'input', e => { scene.fog.density = +e.target.value;
  document.getElementById('fogVal').textContent = (+e.target.value).toFixed(3).slice(1); });
const soundBtn = document.getElementById('sound');
on(soundBtn, 'click', e => {
  soundOn = !soundOn; e.target.textContent = 'Sound: ' + (soundOn ? 'on' : 'off');
  if(audio) audio.master.gain.setTargetAtTime(soundOn ? 0.6 : 0.0001, audio.ctx.currentTime, 0.1);
});
const regenBtn = document.getElementById('regen');
on(regenBtn, 'click', () => generateMap((Math.random()*1e9)>>>0));
on(window, 'resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  applyRes();
});

// ---- Minimap -------------------------------------------------------------
const mm = document.getElementById('minimap'), mmx = mm.getContext('2d'), MM = mm.width, mmS = MM/CONFIG.mapSize;
const mmStatic = document.createElement('canvas'); mmStatic.width = MM; mmStatic.height = MM;
const sx = mmStatic.getContext('2d');
function w2m(x,z){ return [ (x+half)*mmS, (z+half)*mmS ]; }
function drawMinimapStatic(){
  sx.clearRect(0,0,MM,MM);
  sx.fillStyle = 'rgba(10,14,21,0.5)'; sx.fillRect(0,0,MM,MM);
  sx.strokeStyle = 'rgba(150,175,215,0.25)'; sx.lineWidth = 1; sx.strokeRect(1,1,MM-2,MM-2);
  sx.fillStyle = 'rgba(120,150,120,0.5)';
  for(let i=0;i<treeData.length;i+=4){ const [px,py] = w2m(treeData[i].x, treeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
  const [lx,ly] = w2m(CONFIG.lake.x, CONFIG.lake.z);
  sx.beginPath(); sx.arc(lx, ly, CONFIG.lake.r*mmS, 0, Math.PI*2); sx.fillStyle = 'rgba(134,184,255,0.55)'; sx.fill();
}
function drawMinimap(){
  mmx.clearRect(0,0,MM,MM); mmx.drawImage(mmStatic, 0, 0);
  const [px,py] = w2m(player.x, player.z);
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), a = Math.atan2(fz, fx);
  mmx.save(); mmx.translate(px, py); mmx.rotate(a);
  mmx.fillStyle = '#cfe0ff'; mmx.beginPath();
  mmx.moveTo(6,0); mmx.lineTo(-4,3.5); mmx.lineTo(-4,-3.5); mmx.closePath(); mmx.fill();
  mmx.restore();
}

// ---- Post-processing: bloom + filmic tone map + vignette + dither ---------
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FS_BRIGHT = `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float threshold;
void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126,0.7152,0.0722));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold+0.28, l), 1.0); }`;
const FS_BLUR = `varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 texel;
void main(){ vec2 o = dir*texel; vec3 s = texture2D(tDiffuse, vUv).rgb*0.227027;
  s += texture2D(tDiffuse, vUv + o*1.3846).rgb*0.316216; s += texture2D(tDiffuse, vUv - o*1.3846).rgb*0.316216;
  s += texture2D(tDiffuse, vUv + o*3.2308).rgb*0.070270; s += texture2D(tDiffuse, vUv - o*3.2308).rgb*0.070270;
  gl_FragColor = vec4(s, 1.0); }`;
const FS_COMPOSITE = `varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float bloomStrength; uniform float exposure; uniform float time;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec3 col = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * bloomStrength;
  col = pow(aces(col * exposure), vec3(1.0/2.2));
  float vig = 1.0 - smoothstep(0.35, 1.1, length(vUv-0.5)*1.3);
  col *= mix(0.72, 1.0, vig);
  col += (hash(gl_FragCoord.xy + time*60.0) - 0.5) / 255.0;   // dither kills banding in the dark
  gl_FragColor = vec4(col, 1.0);
}`;
let usePost = false, sceneRT, brightRT, blurA, blurB, fsScene, fsCam, fsQuad, matBright, matBlur, matComposite;
const resLevels = [Math.min(devicePixelRatio,1.5), Math.min(devicePixelRatio,1.1), 0.8].filter((v,i,a)=>a.indexOf(v)===i);
let resIdx = 0, RES = resLevels[0];
function makeTargets(){
  renderer.setPixelRatio(RES); renderer.setSize(innerWidth, innerHeight);
  const W = Math.max(2, Math.floor(innerWidth*RES)), H = Math.max(2, Math.floor(innerHeight*RES));
  const full = { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, type:THREE.UnsignedByteType };
  const half = { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, type:THREE.UnsignedByteType, depthBuffer:false };
  [sceneRT, brightRT, blurA, blurB].forEach(rt => rt && rt.dispose());
  sceneRT = new THREE.WebGLRenderTarget(W, H, full);
  const hw = Math.max(1, W>>1), hh = Math.max(1, H>>1);
  brightRT = new THREE.WebGLRenderTarget(hw, hh, half);
  blurA = new THREE.WebGLRenderTarget(hw, hh, half);
  blurB = new THREE.WebGLRenderTarget(hw, hh, half);
  matBlur.uniforms.texel.value.set(1/hw, 1/hh);
}
function initPost(){
  try {
    fsScene = new THREE.Scene(); fsCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), null); fsScene.add(fsQuad);
    matBright = new THREE.ShaderMaterial({ uniforms:{ tDiffuse:{value:null}, threshold:{value:0.60} }, vertexShader:VS, fragmentShader:FS_BRIGHT });
    matBlur = new THREE.ShaderMaterial({ uniforms:{ tDiffuse:{value:null}, dir:{value:new THREE.Vector2()}, texel:{value:new THREE.Vector2()} }, vertexShader:VS, fragmentShader:FS_BLUR });
    matComposite = new THREE.ShaderMaterial({ uniforms:{ tScene:{value:null}, tBloom:{value:null}, bloomStrength:{value:0.85}, exposure:{value:1.05}, time:{value:0} }, vertexShader:VS, fragmentShader:FS_COMPOSITE });
    makeTargets(); renderPost(0); usePost = true;   // warm-up render forces shader compile; throws fall back below
  } catch(err){ usePost = false; console.warn('Post-processing unavailable, using direct render.', err); }
}
function blit(mat, target){ fsQuad.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); }
function renderPost(t){
  renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
  matBright.uniforms.tDiffuse.value = sceneRT.texture; blit(matBright, brightRT);
  let src = brightRT;
  for(let i=0;i<3;i++){
    matBlur.uniforms.tDiffuse.value = src.texture;  matBlur.uniforms.dir.value.set(1,0); blit(matBlur, blurA);
    matBlur.uniforms.tDiffuse.value = blurA.texture; matBlur.uniforms.dir.value.set(0,1); blit(matBlur, blurB);
    src = blurB;
  }
  matComposite.uniforms.tScene.value = sceneRT.texture;
  matComposite.uniforms.tBloom.value = blurB.texture;
  matComposite.uniforms.time.value = t;
  blit(matComposite, null);
  renderer.setRenderTarget(null);
}
initPost();
if(!usePost){                                   // fallback: let the renderer tone-map directly
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setPixelRatio(RES); renderer.setSize(innerWidth, innerHeight);
}
// adaptive resolution: drop internal scale if frames get expensive, raise if they're cheap
let accT = 0, accN = 0, lastAdapt = 0;
function adaptResolution(dt, t){
  accT += dt; accN++;
  if(t - lastAdapt < 1.5 || accN < 12) return;
  const avg = accT/accN; accT = 0; accN = 0; lastAdapt = t;
  if(avg > 0.024 && resIdx < resLevels.length-1){ resIdx++; RES = resLevels[resIdx]; applyRes(); }
  else if(avg < 0.015 && resIdx > 0){ resIdx--; RES = resLevels[resIdx]; applyRes(); }
}
function applyRes(){ if(usePost) makeTargets(); else { renderer.setPixelRatio(RES); renderer.setSize(innerWidth, innerHeight); } }

// ---- Build the first map, then run ---------------------------------------
generateMap(CONFIG.seed);
const clock = new THREE.Clock();
let bobPhase = 0;
let rafId = null;

function tick(){
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  // hiding: H toggles crouch, any movement key breaks cover
  const moveKey = keys['KeyW']||keys['KeyS']||keys['KeyA']||keys['KeyD']||keys['ArrowUp']||keys['ArrowDown']||keys['ArrowLeft']||keys['ArrowRight'];
  if(hidden && moveKey) hidden = false;
  hideTime = hidden ? hideTime + dt : 0;
  eyeH += ((hidden ? 1.05 : CONFIG.eye) - eyeH) * Math.min(1, dt*8);

  const playing = entered && !paused && !won && !dead && !pickingUp;

  let spd = 0, dist = 0;
  if(playing && !hidden){
    const running = keys['ShiftLeft'] || keys['ShiftRight'];
    const maxSpd = running ? walk*1.8 : walk;
    let ix = 0, iz = 0;
    if(keys['KeyW'] || keys['ArrowUp'])    iz += 1;
    if(keys['KeyS'] || keys['ArrowDown'])  iz -= 1;
    if(keys['KeyD'] || keys['ArrowRight']) ix += 1;
    if(keys['KeyA'] || keys['ArrowLeft'])  ix -= 1;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    let mvx = fx*iz + rx*ix, mvz = fz*iz + rz*ix;
    const mag = Math.hypot(mvx, mvz);
    if(mag > 0){
      mvx /= mag; mvz /= mag; spd = maxSpd;
      const step = maxSpd*dt, lim = half - margin;
      const nx = Math.max(-lim, Math.min(lim, player.x + mvx*step));
      const nz = Math.max(-lim, Math.min(lim, player.z + mvz*step));
      if(!blocked(nx, player.z)){ dist += Math.abs(nx - player.x); player.x = nx; }  // slide along trunks
      if(!blocked(player.x, nz)){ dist += Math.abs(nz - player.z); player.z = nz; }
    }
  }

  if(pickingUp){
    const e = clock.elapsedTime - pickStart;
    // arms rise into frame, gather the child, lift, then release to the sky
    const lift   = key3(e, [[0,-0.95],[1.5,-0.9],[3.5,-0.35],[6,-0.05],[8,0.1],[9.5,-0.5],[10,-0.95]]);
    const fwd    = key3(e, [[0,-0.5],[3.5,-0.72],[6,-0.78],[8,-0.72],[10,-0.5]]);
    const spread = key3(e, [[0,0.3],[3.5,0.1],[6,0.13],[8,0.32],[10,0.3]]);
    const pitchA = key3(e, [[0,0.2],[3.5,-0.35],[6,-0.8],[8,-1.05],[10,0.2]]);
    armL.position.set(-spread, lift, fwd); armL.rotation.set(pitchA, 0,  0.2);
    armR.position.set( spread, lift, fwd); armR.rotation.set(pitchA, 0, -0.2);
    // the child ascends, brightening as it goes
    const ay = key3(e, [[0,0],[3.5,0.25],[5,1.6],[7,12],[9,34],[10,55]]);
    const boomed = e >= 9.3;
    babyGroup.visible = !boomed; babyGroup.position.set(baby.x, ay, baby.z); babyGroup.rotation.y = e*0.6;
    halo.material.opacity = Math.min(0.5, 0.12 + e*0.05);
    bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5 + e*0.15;
    babyLight.intensity = boomed ? 0 : key3(e, [[0,1],[4,3.2],[7,2],[9,3.5]]);
    if(boomed && !pickBoomed){ pickBoomed = true; fireBoom(baby.x, ay, baby.z); }   // the child bursts into the sky
    // camera holds position and tilts up to follow the child, then the burst
    camera.position.set(player.x, CONFIG.eye, player.z);
    lookM.lookAt(camera.position, boomGroup.visible ? boomGroup.position : babyGroup.position, camera.up);
    lookQ.setFromRotationMatrix(lookM);
    camera.quaternion.slerp(lookQ, 0.06);
    if(e >= 11.3) finishPickup();
  } else if(dead){
    // the death "cutscene" is a real video overlay (see #deathVideo); just reveal the loss text at the end
    if((clock.elapsedTime - deathStart) >= CUT_END && !deathShown) revealLoss();
  } else {
    if(spd > 0 && !reduce) bobPhase += dt * 9;
    const bob = spd > 0 && !reduce ? Math.sin(bobPhase) * 0.06 : 0;
    camera.position.set(player.x, eyeH + bob, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  if(playing) updatePredators(dt);   // predators only hunt while you're actually playing

  // ---- threat metrics: nearest predator + who's actively coming for you ----
  let nearDist = 1e9, nearP = null, approaching = false;
  if(playing){
    for(const p of predators){
      const dpd = Math.hypot(player.x - p.x, player.z - p.z);
      if(dpd < nearDist){ nearDist = dpd; nearP = p; }
      if(p.state==='chase' || p.hunt || (p.state==='investigate' && p.inv!=='back')) approaching = true;
    }
    // if nobody has been near for 30s, the closest one comes straight for you
    if(nearDist < 20) sinceClose = 0; else sinceClose += dt;
    if(sinceClose > 30 && nearP && !hidden){ nearP.hunt = true; spotOnto(nearP); sinceClose = 12; }
    // approach piano note: quicker + higher the nearer it is
    if(approaching && nearDist < 46 && !hidden){
      pianoTimer -= dt;
      if(pianoTimer <= 0){
        const near01 = clamp(1 - nearDist/46, 0, 1);           // 0 far … 1 close
        pianoTimer = 1.3 - near01*0.95;                        // interval shortens as it nears
        const steps = [0,3,5,7,10,12][Math.min(5, Math.floor(near01*6))];
        pianoNote(98 * Math.pow(2, steps/12), 0.5 + near01*0.6);   // low, scary; rises as it closes
      }
    } else pianoTimer = 0;
  } else { sinceClose = 0; }
  spotFlash = Math.max(0, spotFlash - dt*1.6);
  spotFlashEl.style.opacity = (spotFlash*0.55).toFixed(3);

  const distLake = Math.hypot(player.x - CONFIG.lake.x, player.z - CONFIG.lake.z);

  // objective + status HUD
  const distBaby = Math.hypot(player.x - baby.x, player.z - baby.z);
  canPickup = !baby.taken && distBaby < 3.6;
  if(playing){
    objective.style.display = 'block';
    if(canPickup){ objective.textContent = 'Press  E  to lift the child'; objective.classList.add('ready'); }
    else { objective.textContent = 'Find the lost child  ·  ' + Math.round(distBaby) + 'm'; objective.classList.remove('ready'); }
    if(hidden){ statusEl.style.display='block'; statusEl.className='hiding';
      const sniffer = predators.some(p => p.state==='investigate' && Math.hypot(player.x-p.x, player.z-p.z) < 6);
      statusEl.textContent = sniffer ? 'Hidden · something is sniffing you — DON’T MOVE'
                                     : 'Hidden · ' + hideTime.toFixed(1) + 's   (move to break cover)'; }
    else statusEl.style.display = 'none';
  } else { objective.style.display = 'none'; statusEl.style.display = 'none'; }

  // the child's idle glow (outside the cinematic)
  if(!baby.taken){
    babyGroup.position.y = Math.sin(t*1.4) * 0.06;
    babyGroup.rotation.y = t * 0.4;
    halo.material.opacity = 0.11 + Math.sin(t*1.8) * 0.05;
    babyLight.intensity = 1.0 + Math.sin(t*1.8) * 0.25;
    const bp = bwisps.geometry.attributes.position.array;
    for(let i=0;i<BW;i++){ bp[i*3+1] += dt*0.4; if(bp[i*3+1] > 3.4) bp[i*3+1] = 0.2; }
    bwisps.geometry.attributes.position.needsUpdate = true;
  }

  // scary music plays ONLY while an animal actually sees you (chasing or bee-lining).
  // lose sight → it starts sniffing/searching and the music falls back to the calm bed;
  // it finds you again (investigate → chase) and the music returns.
  const hunting = playing && predators.some(p => p.state === 'chase' || p.hunt);
  huntTime = hunting ? huntTime + dt : Math.max(0, huntTime - dt*0.5);
  if(audio && soundOn){
    const esc = clamp(huntTime/25 + (nearDist < 1e8 ? clamp(1 - nearDist/40, 0, 1)*0.5 : 0), 0, 1);
    audio.huntGain.gain.setTargetAtTime(hunting ? (0.5 + esc*0.5) : 0.0001, audio.ctx.currentTime, hunting ? 0.25 : 0.6);
    audio.plfo.frequency.setTargetAtTime(2.3 + esc*3.2, audio.ctx.currentTime, 0.4);   // throb speeds up
  }
  if(audio && soundOn && playing){
    const move01 = Math.min(1, spd / (walk*1.8)), now = audio.ctx.currentTime;
    if(hunting){                                     // calm bed drops out
      audio.wg.gain.setTargetAtTime(0.0001, now, 0.3);
      audio.dg.gain.setTargetAtTime(0.0001, now, 0.3);
    } else {
      audio.wg.gain.setTargetAtTime(0.05 + move01*0.10, now, 0.3);
      audio.wf.frequency.setTargetAtTime(320 + move01*900, now, 0.3);
      audio.dg.gain.setTargetAtTime(0.05, now, 0.3);
      audio.twinkle -= dt;
      if(audio.twinkle <= 0){
        const near = distLake < CONFIG.lake.r*3;
        twinkle(near ? 0.10 : 0.05, near && Math.random() < 0.5);
        audio.twinkle = near ? rnd(0.5, 1.6) : rnd(2.5, 6);
      }
    }
    audio.foot += dist;                              // footsteps play in both states
    if(spd > 0.3 && audio.foot >= 1.9){ audio.foot -= 1.9; footstep(0.12); }
  }

  // pool breathes; its wisps rise
  ring.material.opacity = 0.14 + Math.sin(t*0.8)*0.05;
  const lp = lwGeo.attributes.position.array;
  for(let i=0;i<LW;i++){ lp[i*3+1] += dt*0.25; if(lp[i*3+1] > 4.5) lp[i*3+1] = 0.2; }
  lwGeo.attributes.position.needsUpdate = true;

  // ambient dust follows you
  const amp = reduce ? 0.3 : 1, dp = dustGeo.attributes.position.array;
  for(let i=0;i<DUST;i++){
    dp[i*3]   += Math.sin(t*0.4 + i) * dt * 0.12 * amp;
    dp[i*3+1] += Math.sin(t*0.3 + i*1.7) * dt * 0.1 * amp;
    dp[i*3+2] += dt * 0.3 * amp;
    if(dp[i*3+2] > 4)  dp[i*3+2] -= 34;
    if(dp[i*3] > 30)   dp[i*3] -= 60; else if(dp[i*3] < -30) dp[i*3] += 60;
  }
  dustGeo.attributes.position.needsUpdate = true;
  dust.position.copy(camera.position);

  drawMinimap();
  if(!baby.taken){                       // pulsing objective marker on the minimap
    const [bx, bz] = w2m(baby.x, baby.z), r = 3 + Math.sin(t*4) * 1.2;
    mmx.beginPath(); mmx.arc(bx, bz, r, 0, Math.PI*2);
    mmx.fillStyle = 'rgba(255,205,150,0.9)'; mmx.fill();
    mmx.lineWidth = 1; mmx.strokeStyle = 'rgba(255,230,195,0.8)'; mmx.stroke();
  }

  // keep the sky centred on the player; moon billboards toward the camera
  stars.position.copy(camera.position);
  moonGroup.position.copy(camera.position).addScaledVector(moonDir, 300);
  moonGroup.quaternion.copy(camera.quaternion);

  updateBoom(dt);
  if(!dead){ if(usePost) renderPost(t); else renderer.render(scene, camera); }
  adaptResolution(dt, t);
}
tick();

  // ---- Teardown: undo everything the run above did ------------------------
  activeDispose = function dispose() {
    cancelAnimationFrame(rafId);
    timers.forEach(id => clearTimeout(id));
    cleanupFns.forEach(fn => fn());

    if(document.pointerLockElement === el) document.exitPointerLock();
    document.body.style.cursor = '';

    // release every geometry/material/texture reachable from the scene graph
    scene.traverse(obj => {
      if(obj.geometry) obj.geometry.dispose();
      if(obj.material){
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          for(const k in m){ const v = m[k]; if(v && v.isTexture) v.dispose(); }
          m.dispose();
        });
      }
    });
    if(scene.background && scene.background.isTexture) scene.background.dispose();

    // post-processing: fullscreen quad + shader materials + render targets
    if(fsQuad){
      fsQuad.geometry.dispose();
      [matBright, matBlur, matComposite].forEach(m => m && m.dispose());
    }
    [sceneRT, brightRT, blurA, blurB].forEach(rt => rt && rt.dispose());

    // renderer + WebGL context (browsers cap live contexts; release it explicitly)
    renderer.domElement.remove();
    renderer.dispose();
    renderer.forceContextLoss();

    // AudioContext
    if(audio){ try { audio.ctx.close(); } catch(e){} }

    activeDispose = null;
  };
}

function dispose() {
  if(activeDispose) activeDispose();
}

if(typeof window !== 'undefined') window.ForestEngine = { init: init, dispose: dispose };
})();

import * as THREE from './vendor/three.module.min.js';
import { BASES, fenceDist, WALL_H } from './physics.js';
import { IMG } from './assets.js';

const deg = Math.PI / 180;
// shape coords (x, y) -> world (x, 0, -y)
function flat(shape, mat, y = 0, receive = true) {
  const g = new THREE.ShapeGeometry(shape, 48);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = receive; return m;
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function noise(g, w, h, n, colors, size = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = colors[(Math.random() * colors.length) | 0]; g.fillRect(Math.random() * w, Math.random() * h, size, size); }
}

export function buildStadium(scene, renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // ---- grass with mowing stripes (world-aligned big plane) ----
  const grassTex = canvasTex(512, 512, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#3f8a3a' : '#4a9a42'; g.fillRect(0, i * h / 8, w, h / 8); }
    noise(g, w, h, 9000, ['#3a7f35', '#52a249', '#468f3e', '#5aa84f'], 2);
  }, [14, 14]);
  grassTex.anisotropy = maxAniso;
  grassTex.rotation = Math.PI / 4; grassTex.center.set(0.5, 0.5);
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), grassMat);
  ground.position.set(0, -0.02, -250); ground.receiveShadow = true; scene.add(ground);

  const dirtTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#b07a4a'; g.fillRect(0, 0, w, h); noise(g, w, h, 6000, ['#a46f41', '#bb8656', '#9c683c', '#c08d5e'], 2); }, [1, 1]);
  dirtTex.anisotropy = maxAniso;
  const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
  const setUV = (geo, scale) => { const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale); uv.needsUpdate = true; };

  // ---- infield dirt: arc of radius 95 around the rubber, closed along the foul lines ----
  const dirt = new THREE.Shape();
  dirt.moveTo(0, 0);
  const a0 = -47, a1 = 47;
  // point on arc centered (0,-60.5) at radius 95, by angle from home's view
  for (let a = a0; a <= a1; a += 1) {
    // find point along ray from home at angle a whose distance to rubber is 95
    const dx = Math.sin(a * deg), dz = -Math.cos(a * deg);
    // solve |t*d - c| = 95, c=(0,-60.5)
    const b = 2 * (dz * 60.5), c = 60.5 * 60.5 - 95 * 95;
    const t = (-b + Math.sqrt(b * b - 4 * c)) / 2;
    dirt.lineTo(dx * t, -dz * t);
  }
  dirt.lineTo(0, 0);
  const dirtMesh = flat(dirt, dirtMat, 0.01); setUV(dirtMesh.geometry, 30); scene.add(dirtMesh);

  // infield grass square (inside base paths)
  const ig = new THREE.Shape();
  const inset = 6.5, r = 63.64;
  ig.moveTo(0, inset * 1.414); ig.lineTo(r - inset, r); ig.lineTo(0, 2 * r - inset * 1.414); ig.lineTo(-(r - inset), r); ig.closePath();
  const igMat = new THREE.MeshLambertMaterial({ map: grassTex.clone() });
  igMat.map.repeat.set(1 / 12, 1 / 12);
  const igMesh = flat(ig, igMat, 0.02); setUV(igMesh.geometry, 12); scene.add(igMesh);
  // home plate dirt circle, mound, base cutouts
  const circ = (x, z, rad, mat, y) => { const m = new THREE.Mesh(new THREE.CircleGeometry(rad, 40).rotateX(-Math.PI / 2), mat); m.position.set(x, y, z); m.receiveShadow = true; setUV(m.geometry, 30); scene.add(m); return m; };
  circ(0, 0, 13, dirtMat, 0.03);
  BASES.slice(1).forEach(([x, z]) => circ(x, z, 9, dirtMat, 0.03));
  // base paths home->1st, home->3rd on top of grass
  [1, 3].forEach(i => {
    const [bx, bz] = BASES[i]; const len = Math.hypot(bx, bz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, len).rotateX(-Math.PI / 2), dirtMat);
    m.position.set(bx / 2, 0.025, bz / 2); m.rotation.y = Math.atan2(bx, bz); m.receiveShadow = true; scene.add(m);
  });
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(5, 9, 0.8, 40), dirtMat);
  mound.position.set(0, 0.4, -60.5); mound.receiveShadow = true; scene.add(mound);
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f6f2 });
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 0.5), white); rubber.position.set(0, 0.84, -60.5); scene.add(rubber);

  // warning track
  const wt = new THREE.Shape();
  const pts = [];
  for (let a = -45; a <= 45; a += 1) pts.push(a);
  pts.forEach((a, i) => { const d = fenceDist(a) - 14; const p = [Math.sin(a * deg) * d, -Math.cos(a * deg) * d]; i ? wt.lineTo(p[0], -p[1]) : wt.moveTo(p[0], -p[1]); });
  pts.slice().reverse().forEach(a => { const d = fenceDist(a) + 2; wt.lineTo(Math.sin(a * deg) * d, Math.cos(a * deg) * d); });
  const wtMat = new THREE.MeshLambertMaterial({ color: 0x9a6b42, map: dirtTex });
  const wtMesh = flat(wt, wtMat, 0.02); setUV(wtMesh.geometry, 30); scene.add(wtMesh);

  // ---- chalk ----
  const chalk = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const line = (x0, z0, x1, z1, w = 0.3, y = 0.05) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2), chalk);
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.rotation.y = Math.atan2(x1 - x0, z1 - z0); scene.add(m);
  };
  const fd45 = fenceDist(45);
  line(1, -1, Math.sin(45 * deg) * fd45, -Math.cos(45 * deg) * fd45);
  line(-1, -1, -Math.sin(45 * deg) * fd45, -Math.cos(45 * deg) * fd45);
  // batter's boxes
  [-1, 1].forEach(s => {
    const x0 = s * 0.95, x1 = s * 4.95, z0 = 3, z1 = -3;
    line(x0, z0, x0, z1, 0.25, 0.06); line(x1, z0, x1, z1, 0.25, 0.06); line(x0, z0, x1, z0, 0.25, 0.06); line(x0, z1, x1, z1, 0.25, 0.06);
  });
  // catcher's box
  line(-1.8, 1.2, -1.8, 9, 0.2, 0.06); line(1.8, 1.2, 1.8, 9, 0.2, 0.06);
  // home plate (pentagon)
  const hp = new THREE.Shape(); hp.moveTo(-0.708, 0.708); hp.lineTo(0.708, 0.708); hp.lineTo(0.708, 0); hp.lineTo(0, -0.708); hp.lineTo(-0.708, 0); hp.closePath();
  const hpm = flat(hp, white, 0.07); scene.add(hpm);
  // bases
  BASES.slice(1).forEach(([x, z]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.25, 1.25), white);
    b.position.set(x, 0.12, z); b.rotation.y = 45 * deg; b.castShadow = true; scene.add(b);
  });

  // ---- outfield wall ----
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x0f2a4f });
  const capMat = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
  const wallPts = [];
  for (let a = -45; a <= 45.01; a += 1.5) wallPts.push([Math.sin(a * deg) * fenceDist(a), -Math.cos(a * deg) * fenceDist(a), a]);
  for (let i = 0; i < wallPts.length - 1; i++) {
    const [x0, z0] = wallPts[i], [x1, z1] = wallPts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0) + 0.2;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, 1.2), wallMat);
    seg.position.set((x0 + x1) / 2, WALL_H / 2, (z0 + z1) / 2); seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0); seg.receiveShadow = true; scene.add(seg);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, 1.3), capMat); cap.position.copy(seg.position); cap.position.y = WALL_H + 0.1; cap.rotation.copy(seg.rotation); scene.add(cap);
  }
  // distance markers
  [[-45, ''], [-22, ''], [0, ''], [22, ''], [45, '']].forEach(([a]) => {
    const d = Math.round(fenceDist(a));
    const tex = canvasTex(256, 128, (g) => { g.fillStyle = '#0f2a4f'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#fff'; g.font = '900 86px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d, 128, 68); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: tex }));
    const dd = fenceDist(a) - 1.6;
    m.position.set(Math.sin(a * deg) * dd, 4.6, -Math.cos(a * deg) * dd); m.lookAt(0, 4.6, 0); scene.add(m);
  });
  // foul poles
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xf5d020 });
  [-45, 45].forEach(a => {
    const d = fenceDist(a);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 48, 10), poleMat);
    p.position.set(Math.sin(a * deg) * d, 24, -Math.cos(a * deg) * d); p.castShadow = true; scene.add(p);
  });

  // ---- stands with crowd ----
  const crowdTex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#26303d'; g.fillRect(0, 0, w, h);
    const shirts = ['#e8e8e8', '#0b2b53', '#70bdf5', '#c0392b', '#f1c40f', '#2c3e50', '#ecf0f1', '#16a085', '#8e44ad', '#d35400', '#ffffff', '#1f4e8c', '#7fb3d5'];
    const skins = ['#f1c7a5', '#d9a77e', '#a86f48', '#7a4b2a', '#e8b896'];
    for (let row = 0; row < 16; row++) {
      const y = row * 16 + 4;
      g.fillStyle = '#1b222c'; g.fillRect(0, y + 11, w, 4);
      for (let x = 2; x < w; x += 9) {
        if (Math.random() < 0.12) continue;
        g.fillStyle = shirts[(Math.random() * shirts.length) | 0]; g.fillRect(x, y + 5, 7, 7);
        g.fillStyle = skins[(Math.random() * skins.length) | 0]; g.fillRect(x + 1.5, y, 4, 5);
      }
    }
  });
  crowdTex.wrapS = THREE.RepeatWrapping;
  const crowdMat = new THREE.MeshLambertMaterial({ map: crowdTex, side: THREE.DoubleSide });
  const padMat = new THREE.MeshLambertMaterial({ color: 0x0b2b53 });
  function seating(path, depth, rise, baseH, outwardSign) {
    // path: array of [x,z]; build sloped strip outward (normal computed toward outside)
    const pos = [], uv = [], idx = [];
    let u = 0;
    for (let i = 0; i < path.length; i++) {
      const [x, z] = path[i];
      const [xa, za] = path[Math.max(0, i - 1)], [xb, zb] = path[Math.min(path.length - 1, i + 1)];
      let tx = xb - xa, tz = zb - za; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz * outwardSign, nz = tx * outwardSign;
      if (i) u += Math.hypot(x - path[i - 1][0], z - path[i - 1][1]) / 110;
      pos.push(x, baseH, z, x + nx * depth, baseH + rise, z + nz * depth);
      uv.push(u, 0, u, 1);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, crowdMat); scene.add(m);
    // padded front wall
    const wpos = [], widx = [];
    path.forEach(([x, z], i) => { wpos.push(x, 0, z, x, baseH, z); if (i) { const k = i * 2; widx.push(k - 2, k, k - 1, k - 1, k, k + 1); } });
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); wg.setIndex(widx); wg.computeVertexNormals();
    const wm = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x0b2b53, side: THREE.DoubleSide })); scene.add(wm);
  }
  // foul-territory boundary: from right pole, along line offset 46ft, around backstop, to left pole
  const fpath = [];
  const off = 46;
  const L = fenceDist(45) + 4;
  for (let s = L; s >= 40; s -= 12) fpath.push([s * 0.7071 + off * 0.7071, -s * 0.7071 + off * 0.7071]);
  // backstop arc behind home (z ~ 52)
  for (let a = 30; a <= 150; a += 6) { const ang = a * deg; fpath.push([Math.cos(ang) * 60, 52 - 8 + Math.sin(ang) * 8]); }
  for (let s = 40; s <= L; s += 12) fpath.push([-s * 0.7071 - off * 0.7071, -s * 0.7071 + off * 0.7071]);
  // order fix: right side first (x>0) to left; reverse so outward is consistent
  seating(fpath, 90, 52, 7, -1);
  // outfield bleachers beyond the wall
  const opath = [];
  for (let a = -46; a <= 46; a += 3) { const d = fenceDist(a) + 14; opath.push([Math.sin(a * deg) * d, -Math.cos(a * deg) * d]); }
  seating(opath, 70, 44, 12, -1);
  // batter's eye in dead center
  const eye = new THREE.Mesh(new THREE.BoxGeometry(70, 30, 2), new THREE.MeshLambertMaterial({ color: 0x16301f }));
  eye.position.set(0, 15, -fenceDist(0) - 12); scene.add(eye);

  // ---- GS logos around the park ----
  if (IMG.logoLight) {
    const lt = new THREE.Texture(IMG.logoLight); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = maxAniso; lt.needsUpdate = true;
    const ar = IMG.logoLight.height / IMG.logoLight.width;
    // mowed into center-field grass
    const grassLogo = new THREE.Mesh(new THREE.PlaneGeometry(70, 70 * ar).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: lt, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    grassLogo.position.set(0, 0.05, -235); grassLogo.receiveShadow = true; scene.add(grassLogo);
    // behind home plate on the backstop pad
    const back = new THREE.Mesh(new THREE.PlaneGeometry(10, 10 * ar), new THREE.MeshBasicMaterial({ map: lt, transparent: true, alphaTest: 0.1 }));
    back.position.set(0, 3.5, 51.4); back.rotation.y = Math.PI; scene.add(back);
    // on the batter's eye
    const eyeLogo = new THREE.Mesh(new THREE.PlaneGeometry(34, 34 * ar), new THREE.MeshBasicMaterial({ map: lt, transparent: true, alphaTest: 0.1 }));
    eyeLogo.position.set(0, 16, -fenceDist(0) - 10.9); scene.add(eyeLogo);
    // outfield wall
    [-32, -12, 12, 32].forEach(a => {
      const d = fenceDist(a) - 0.75;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(7, 7 * ar), new THREE.MeshBasicMaterial({ map: lt, transparent: true, alphaTest: 0.1 }));
      w.position.set(Math.sin(a * deg) * d, 4.2, -Math.cos(a * deg) * d); w.lookAt(0, 4.2, 0); scene.add(w);
    });
  }

  // ---- scoreboard ----
  const sbCanvas = document.createElement('canvas'); sbCanvas.width = 1024; sbCanvas.height = 384;
  const sbTex = new THREE.CanvasTexture(sbCanvas); sbTex.colorSpace = THREE.SRGBColorSpace;
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(96, 36), new THREE.MeshBasicMaterial({ map: sbTex }));
  const sbx = 140, sbz = -fenceDist(18) - 75;
  sb.position.set(sbx, 62, sbz); sb.lookAt(0, 30, 0); scene.add(sb);
  const sbBack = new THREE.Mesh(new THREE.BoxGeometry(100, 40, 3), new THREE.MeshLambertMaterial({ color: 0x0a1424 }));
  sbBack.position.copy(sb.position); sbBack.quaternion.copy(sb.quaternion); sbBack.translateZ(-1.8); scene.add(sbBack);
  [-30, 30].forEach(o => { const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 44, 3), new THREE.MeshLambertMaterial({ color: 0x2a3340 })); leg.position.copy(sb.position); leg.quaternion.copy(sb.quaternion); leg.translateX(o); leg.translateZ(-2); leg.position.y = 22; scene.add(leg); });
  function drawScoreboard(info) {
    const g = sbCanvas.getContext('2d');
    g.fillStyle = '#060b14'; g.fillRect(0, 0, 1024, 384);
    g.strokeStyle = '#70bdf5'; g.lineWidth = 6; g.strokeRect(8, 8, 1008, 368);
    g.fillStyle = '#70bdf5'; g.font = '900 44px system-ui, sans-serif'; g.textAlign = 'left';
    if (IMG.logoLight) { const h = 70, w = h / IMG.logoLight.height * IMG.logoLight.width; g.drawImage(IMG.logoLight, 26, 12, w, h); g.fillText('BASEBALL', 40 + w, 64); } else g.fillText('GS BASEBALL', 30, 62);
    g.textAlign = 'right'; g.fillStyle = '#ffd34d'; g.fillText(info.status || '', 994, 62);
    const cols = Math.max(6, info.innings || 6);
    const x0 = 230, cw = Math.min(64, 560 / cols);
    g.font = '800 30px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#9fb3c8';
    for (let i = 0; i < cols; i++) g.fillText(i + 1, x0 + cw * i + cw / 2, 118);
    g.fillText('R', 870, 118); g.fillText('H', 930, 118); g.fillText('E', 985, 118);
    (info.teams || []).forEach((t, k) => {
      const y = 180 + k * 70;
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = '900 40px system-ui, sans-serif'; g.fillText(t.abbr, 30, y);
      g.textAlign = 'center'; g.font = '800 34px system-ui, sans-serif'; g.fillStyle = '#ffd34d';
      for (let i = 0; i < cols; i++) { const v = t.line[i]; g.fillText(v == null ? '' : v, x0 + cw * i + cw / 2, y); }
      g.fillStyle = '#fff'; g.font = '900 40px system-ui, sans-serif';
      g.fillText(t.r, 870, y); g.fillText(t.h, 930, y); g.fillText(t.e, 985, y);
    });
    g.textAlign = 'left'; g.fillStyle = '#9fb3c8'; g.font = '800 30px system-ui, sans-serif';
    g.fillText(info.batter || '', 30, 352);
    g.textAlign = 'right'; g.fillText(info.count || '', 994, 352);
    sbTex.needsUpdate = true;
  }
  drawScoreboard({ teams: [] });

  // ---- light towers ----
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x5b6573 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe6 });
  [[-230, -40], [230, -40], [-260, -300], [260, -300], [-120, 70], [120, 70]].forEach(([x, z]) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2, 120, 8), towerMat); t.position.set(x, 60, z); scene.add(t);
    const bank = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 2), lampMat); bank.position.set(x, 124, z); bank.lookAt(0, 0, -150); scene.add(bank);
  });

  // ---- dugouts ----
  [-1, 1].forEach(s => {
    const d = new THREE.Mesh(new THREE.BoxGeometry(40, 7, 9), new THREE.MeshLambertMaterial({ color: 0x14325a }));
    d.position.set(s * (60 * 0.7071 + 42 * 0.7071) - s * 2, 3.5, -60 * 0.7071 + 42 * 0.7071 + 2); d.rotation.y = s * -45 * deg; scene.add(d);
  });

  // ---- sky ----
  const skyTex = canvasTex(16, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2f6fb8'); gr.addColorStop(0.45, '#79b3e6'); gr.addColorStop(0.5, '#bcd9f0'); gr.addColorStop(1, '#dce9f2');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  sky.position.set(0, 0, -200); scene.add(sky);
  // distant tree line
  const trees = new THREE.Mesh(new THREE.CylinderGeometry(1300, 1300, 60, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0x2f5a3a, side: THREE.BackSide, fog: true }));
  trees.position.set(0, 20, -200); scene.add(trees);

  return { drawScoreboard };
}

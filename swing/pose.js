// MoveNet Thunder pose engine on TensorFlow.js (WebGL), driven by an exported op list.
// Model: Google MoveNet SinglePose Thunder v4 (Apache-2.0), converted from ONNX to NHWC ops
// with 16-bit per-channel weights.

export async function loadPose(tf, base, onProgress = () => {}) {
  const spec = await (await fetch(base + 'movenet-thunder.json')).json();
  const res = await fetch(base + 'movenet-thunder.q16.wasm');
  if (!res.ok) throw new Error('Could not load the pose model (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || spec.bytes;
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress(Math.min(got / total, 1));
    }
    const all = new Uint8Array(got); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    buf = all.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  onProgress(1);

  // ---- weights -> tensors -------------------------------------------------
  const W = {};
  for (const [name, t] of Object.entries(spec.tensors)) {
    let data;
    if (t.dt === 'f32') {
      data = new Float32Array(buf, t.o, t.n);
    } else {
      const q = new Int16Array(buf, t.o, t.n);
      const sc = new Float32Array(buf, t.so, t.sn);
      data = new Float32Array(t.n);
      // channel index of element i for the quantised axis
      const s = t.s; let inner = 1;
      for (let a = t.ax + 1; a < s.length; a++) inner *= s[a];
      const C = s[t.ax];
      for (let i = 0; i < t.n; i++) data[i] = q[i] * sc[Math.floor(i / inner) % C];
    }
    W[name] = tf.tensor(data, t.s, 'float32');
  }

  // ---- fuse conv + activation where the activation is the conv's only consumer
  const uses = new Map();
  for (const op of spec.ops) for (const k of ['x', 'x2']) if (k in op) uses.set(op[k], (uses.get(op[k]) || 0) + 1);
  const plan = [];
  for (let i = 0; i < spec.ops.length; i++) {
    const op = spec.ops[i], nx = spec.ops[i + 1];
    if ((op.op === 'conv' || op.op === 'dw') && nx && (nx.op === 'relu6' || nx.op === 'relu') && nx.x === op.y && uses.get(op.y) === 1) {
      plan.push({ ...op, act: nx.op, y: nx.y, free: [...op.free, ...nx.free] });
      i++;
    } else plan.push(op);
  }
  const headIds = spec.heads;
  const G = spec.post.grid;
  const centerW = Float32Array.from(spec.post.centerWeight);
  const distBias = spec.post.distBias;

  function runBody(input) {        // input: [1,256,256,3] float in [-1,1]
    const v = new Map([[spec.pre, input]]);
    const keep = new Set(Object.values(headIds));
    for (const op of plan) {
      const x = v.get(op.x);
      let y;
      if (op.op === 'conv') {
        y = tf.fused.conv2d({ x, filter: W[op.w], strides: op.s, pad: op.p, bias: W[op.b], activation: op.act || 'linear' });
      } else if (op.op === 'dw') {
        y = tf.fused.depthwiseConv2d({ x, filter: W[op.w], strides: op.s, pad: op.p, bias: W[op.b], activation: op.act || 'linear' });
      } else if (op.op === 'relu6') y = tf.relu6(x);
      else if (op.op === 'relu') y = tf.relu(x);
      else if (op.op === 'sigmoid') y = tf.sigmoid(x);
      else if (op.op === 'add') y = tf.add(x, v.get(op.x2));
      else if (op.op === 'affine') y = tf.add(tf.mul(x, W[op.scale]), W[op.shift]);
      else if (op.op === 'resize') y = tf.image.resizeBilinear(x, op.size, false, true);
      else throw new Error('unknown op ' + op.op);
      v.set(op.y, y);
      for (const f of op.free) { if (!keep.has(f) && f !== spec.pre) { const t = v.get(f); if (t && t !== y) t.dispose(); v.delete(f); } }
    }
    return tf.concat([v.get(headIds.regress), v.get(headIds.offset), v.get(headIds.heatmap), v.get(headIds.center)], 3);
  }

  function post(h) {               // h: Float32Array [64*64*86] HWC: 34 regress | 34 offset | 17 heatmap | 1 center
    const C = 86, R = 0, O = 34, HM = 68, CT = 85;
    let best = -Infinity, bi = 0;
    for (let i = 0; i < G * G; i++) { const s = h[i * C + CT] * centerW[i]; if (s > best) { best = s; bi = i; } }
    const cy = Math.floor(bi / G), cx = bi % G;
    const out = new Float32Array(17 * 3);
    for (let k = 0; k < 17; k++) {
      const ry = cy + h[bi * C + R + 2 * k], rx = cx + h[bi * C + R + 2 * k + 1];
      let bs = -Infinity, bj = 0;
      for (let y = 0; y < G; y++) {
        const dy2 = (y - ry) * (y - ry);
        for (let x = 0; x < G; x++) {
          const j = y * G + x;
          const s = h[j * C + HM + k] / (Math.sqrt((x - rx) * (x - rx) + dy2) + distBias);
          if (s > bs) { bs = s; bj = j; }
        }
      }
      const hy = Math.floor(bj / G), hx = bj % G;
      out[k * 3] = (hy + h[bj * C + O + 2 * k]) / G;
      out[k * 3 + 1] = (hx + h[bj * C + O + 2 * k + 1]) / G;
      out[k * 3 + 2] = h[bj * C + HM + k];
    }
    return out;
  }

  // source: a 256x256 canvas (or ImageData / Int32 array) of the crop
  async function estimate(source) {
    const heads = tf.tidy(() => {
      let x;
      if (source instanceof Int32Array || source instanceof Float32Array) x = tf.tensor(source, [256, 256, 3], 'float32');
      else x = tf.cast(tf.browser.fromPixels(source), 'float32');
      return runBody(tf.sub(tf.div(x, 127.5), 1).expandDims(0));
    });
    const h = await heads.data();
    heads.dispose();
    return post(h);
  }

  // warm-up so the first real frame is not slow (compiles shaders)
  await estimate(new Float32Array(256 * 256 * 3));
  return { estimate, backend: tf.getBackend(), dispose() { for (const t of Object.values(W)) t.dispose(); } };
}

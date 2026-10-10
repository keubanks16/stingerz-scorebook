// Builds the crowd sounds off the main thread so the game never stutters.
import { makeCheer, makeOoh, makeAww, makeMurmur } from './crowd.js';
self.onmessage = (e) => {
  const sr = e.data.sr;
  const out = { sr, murmur: makeMurmur(sr), cheer: makeCheer(sr), cheer2: makeCheer(sr, 6, 99), ooh: makeOoh(sr), aww: makeAww(sr) };
  const bufs = Object.values(out).filter(v => v && v.buffer).map(v => v.buffer);
  self.postMessage(out, bufs);
};

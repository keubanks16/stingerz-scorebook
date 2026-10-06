// Shared images (GS logos) — loaded once before any 3D players are built.
export const IMG = {};
function load(key, src) { return new Promise(res => { const i = new Image(); i.onload = () => { IMG[key] = i; res(i); }; i.onerror = () => res(null); i.src = src; }); }
export const ready = Promise.all([load('logoLight', 'img/gs-logo-light.png'), load('logoNavy', 'img/gs-logo-navy.png')]);

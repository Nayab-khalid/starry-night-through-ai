// Starry Night: GL engine, state, controls.
(function () {
  'use strict';
  const SN = window.SN;
  const $ = (id) => document.getElementById(id);
  const ASPECT = 960 / 760;

  // ------------------------------------------------------------------ parameters
  // ui:false parameters keep a fixed value (presets may still set them).
  const PARAMS = [
    { id: 'speed', group: 'Wind', label: 'Speed', min: 0, max: 3, step: 0.01, def: 1 },
    { id: 'swirlGain', group: 'Wind', label: 'Swirl strength', min: 0, max: 2.5, step: 0.01, def: 1 },
    { id: 'swirlSize', group: 'Wind', label: 'Swirl size', min: 0.5, max: 1.8, step: 0.01, def: 1 },
    { id: 'turb', group: 'Wind', label: 'Turbulence', min: 0, max: 3, step: 0.01, def: 1 },
    { id: 'stir', group: 'Wind', label: 'Mouse wind', min: 0, max: 3, step: 0.01, def: 1 },

    { id: 'strokeLen', group: 'Brush', label: 'Stroke length', min: 0.01, max: 0.15, step: 0.001, def: 0.06 },
    { id: 'strokeWidth', group: 'Brush', label: 'Stroke width', min: 2, max: 24, step: 0.5, def: 7 },
    { id: 'detail', group: 'Brush', label: 'Bristle detail', min: 0, max: 3, step: 0.01, def: 1.15 },
    { id: 'impasto', group: 'Brush', label: 'Paint thickness', min: 0, max: 3, step: 0.01, def: 1.2 },

    { id: 'hueSky', group: 'Colour', label: 'Sky hue', min: -0.5, max: 0.5, step: 0.005, def: 0 },
    { id: 'hueLight', group: 'Colour', label: 'Star & moon hue', min: -0.5, max: 0.5, step: 0.005, def: 0 },
    { id: 'sat', group: 'Colour', label: 'Saturation', min: 0, max: 2, step: 0.01, def: 1.05 },
    { id: 'bright', group: 'Colour', label: 'Brightness', min: -0.3, max: 0.3, step: 0.005, def: 0 },

    { id: 'starGain', ui: false, def: 1 }, { id: 'spiral', ui: false, def: 0.3 }, { id: 'jet', ui: false, def: 1 },
    { id: 'turbScale', ui: false, def: 1 }, { id: 'wind', ui: false, def: 0 },
    { id: 'strokeVar', ui: false, def: 1 }, { id: 'edge', ui: false, def: 85 }, { id: 'smooth', ui: false, def: 1 },
    { id: 'shimmer', ui: false, def: 0.28 }, { id: 'light', ui: false, def: 135 }, { id: 'gloss', ui: false, def: 0.3 },
    { id: 'canvas', ui: false, def: 0.5 }, { id: 'hueFoliage', ui: false, def: 0 }, { id: 'hueAll', ui: false, def: 0 },
    { id: 'contrast', ui: false, def: 1.05 }, { id: 'vignette', ui: false, def: 0.35 },
    { id: 'steps', ui: false, def: 20 }, { id: 'scale', ui: false, def: 1 },
  ];
  const COLOUR_IDS = ['hueSky', 'hueLight', 'hueFoliage', 'hueAll', 'sat', 'bright', 'contrast'];
  const PRESETS = {
    'Classic': {},
    'Emerald': { hueSky: -0.25, hueLight: 0.05, hueFoliage: -0.04, sat: 0.95, bright: -0.02 },
    'Golden hour': { hueSky: 0.49, hueLight: 0.03, sat: 1.1 },
    'Rose': { hueSky: 0.3, hueLight: -0.06 },
    'Midnight': { sat: 0.75, bright: -0.07, contrast: 1.12, hueSky: -0.03 },
    'Mono': { sat: 0, contrast: 1.1 },
  };

  const params = {};
  PARAMS.forEach((p) => (params[p.id] = p.def));
  const flags = { simSky: false, edit: false, paused: false };

  // ------------------------------------------------------------------ swirls, stars, moon
  const STAR_LIST = [
    [0.107, 0.043, 0.062], [0.229, 0.029, 0.034], [0.344, 0.039, 0.044], [0.411, 0.063, 0.034],
    [0.238, 0.171, 0.048], [0.609, 0.086, 0.060], [0.706, 0.230, 0.056], [0.325, 0.326, 0.038],
    [0.352, 0.529, 0.082], [0.130, 0.476, 0.044], [0.044, 0.451, 0.030],
  ];
  let nextId = 1;
  function defaultEntities() {
    nextId = 1;
    const list = [
      { type: 'swirl', name: 'Great swirl', u: 0.49, v: 0.37, s: 0.105, a: 1.3, halo: [0.25, 0.423] },
      { type: 'swirl', name: 'Second swirl', u: 0.685, v: 0.455, s: 0.062, a: -0.95 },
    ];
    STAR_LIST.forEach((s, i) => list.push({ type: 'star', name: 'Star ' + (i + 1), u: s[0], v: s[1], R: s[2], a: 0.2 * (i % 2 ? 1 : -1) }));
    list.push({ type: 'moon', name: 'Moon', u: 0.903, v: 0.165, R: 0.064, a: 0.18 });
    list.forEach((e) => (e.id = nextId++));
    return list;
  }
  let entities = defaultEntities();
  let selectedId = 1;

  function packVortices() {
    const V = new Float32Array(32 * 4), T = new Float32Array(32);
    let n = 0;
    const push = (u, v, s, a, t) => { if (n < 32) { V.set([u, v, s, a], n * 4); T[n] = t; n++; } };
    for (const e of entities) {
      if (e.type === 'swirl') { push(e.u, e.v, e.s, e.a, 0); if (e.halo) push(e.u, e.v, e.halo[0], e.a * e.halo[1], 0); }
      else if (e.type === 'star') push(e.u, e.v, e.R * 0.55, e.a, 1);
      else if (e.type === 'moon') push(e.u, e.v, e.R * 1.2, e.a, 1);
    }
    return { V, T, n };
  }
  function packStars() {
    const S = new Float32Array(16 * 4);
    let n = 0, moon = [0, 0, 0, 0];
    for (const e of entities) {
      if (e.type === 'star' && n < 16) { S.set([e.u, e.v, e.R, 0], n * 4); n++; }
      if (e.type === 'moon') moon = [e.u, e.v, e.R, 0];
    }
    return { S, n, moon };
  }

  // ------------------------------------------------------------------ WebGL
  const canvas = $('gl');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  function fatal(msg) { const f = $('fatal'); f.textContent = msg; f.hidden = false; }
  if (!gl) { fatal('This browser does not support WebGL 2. Try a recent Chrome, Edge or Firefox.'); return; }
  if (!gl.getExtension('EXT_color_buffer_float')) { fatal('This device cannot render to float textures (EXT_color_buffer_float).'); return; }

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log);
      fatal('Shader error:\n' + log);
      throw new Error(log);
    }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, SN.shaders.VERT);
  function makeProgram(fsSrc) {
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { const l = gl.getProgramInfoLog(prog); console.error(l); fatal(l); throw new Error(l); }
    const locs = {};
    const loc = (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(prog, n)));
    return {
      use() { gl.useProgram(prog); return this; },
      f(n, v) { gl.uniform1f(loc(n), v); return this; },
      i(n, v) { gl.uniform1i(loc(n), v); return this; },
      v2(n, a, b) { gl.uniform2f(loc(n), a, b); return this; },
      v4(n, a, b, c, d) { gl.uniform4f(loc(n), a, b, c, d); return this; },
      arr4(n, a) { gl.uniform4fv(loc(n), a); return this; },
      arr1(n, a) { gl.uniform1fv(loc(n), a); return this; },
      tex(n, t, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc(n), unit); return this; },
    };
  }
  const progFlow = makeProgram(SN.shaders.FLOW);
  const progTarget = makeProgram(SN.shaders.TARGET);
  const progLic = makeProgram(SN.shaders.LIC);
  const progFinal = makeProgram(SN.shaders.FINAL);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  function makeTex(w, h, { internal = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE, data = null, mip = false } = {}) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  function makeTarget(w, h, opts) {
    const tex = makeTex(w, h, opts);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { fatal('Could not create a render target.'); throw new Error('fbo'); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }
  function imageTex(img, { filter = gl.LINEAR } = {}) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

  const FLOW_W = 480, FLOW_H = 380, TGT_W = 960, TGT_H = 760;
  const flowRT = makeTarget(FLOW_W, FLOW_H, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR });
  const targetRT = makeTarget(TGT_W, TGT_H, { mip: true });
  let licRT = null;
  const noiseData = new Uint8Array(512 * 512 * 4);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.floor(Math.random() * 256);
  const noiseTex = makeTex(512, 512, { data: noiseData, wrap: gl.REPEAT });
  let refTex = null, sceneTex = null, regionTex = null;

  // ------------------------------------------------------------------ render
  let simTime = 0;
  const gust = { u: 0.5, v: 0.5, vx: 0, vy: 0 };
  const CLASS_LEN = new Float32Array([1.0, 1.15, 1.15, 0.7, 0.45, 1.0, 1.0, 1.0]);

  function pass(target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render() {
    if (!refTex || !licRT) return;
    const { V, T, n } = packVortices();
    const st = packStars();

    progFlow.use().f('uAspect', ASPECT).f('uTime', simTime).f('uWind', params.wind)
      .f('uSwirlGain', params.swirlGain).f('uStarGain', params.starGain).f('uSwirlSize', params.swirlSize)
      .f('uTurb', params.turb).f('uTurbScale', params.turbScale).f('uJet', params.jet).f('uSpiral', params.spiral)
      .f('uUseScene', 1).f('uSceneWind', 0.25)
      .i('uVN', n).arr4('uV', V).arr1('uT', T)
      .v4('uGust', gust.u, gust.v, gust.vx, gust.vy).f('uGustStr', params.stir)
      .tex('uScene', sceneTex, 0).tex('uRegion', regionTex, 1);
    pass(flowRT, FLOW_W, FLOW_H);

    progTarget.use().f('uAspect', ASPECT).f('uTime', simTime).f('uSimSky', flags.simSky ? 1 : 0).f('uBand', 20)
      .i('uVN', n).arr4('uV', V).arr1('uT', T).i('uStarN', st.n).arr4('uStar', st.S)
      .v4('uMoon', st.moon[0], st.moon[1], st.moon[2], 0)
      .tex('uRef', refTex, 0).tex('uFlow', flowRT.tex, 1).tex('uScene', sceneTex, 2);
    pass(targetRT, TGT_W, TGT_H);
    gl.bindTexture(gl.TEXTURE_2D, targetRT.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    progLic.use().v2('uRes', licRT.w, licRT.h).f('uAspect', ASPECT).f('uTime', simTime)
      .f('uLen', params.strokeLen).f('uWidthPx', params.strokeWidth * licRT.h / 760).f('uEdge', params.edge)
      .f('uLod', params.smooth).f('uBristle', params.detail).f('uStrokeVar', params.strokeVar)
      .f('uShimmer', params.shimmer).i('uSteps', Math.round(params.steps)).arr1('uClassLen', CLASS_LEN)
      .tex('uFlow', flowRT.tex, 0).tex('uTarget', targetRT.tex, 1).tex('uNoise', noiseTex, 2);
    pass(licRT, licRT.w, licRT.h);

    progFinal.use().v2('uRes', licRT.w, licRT.h).f('uImpasto', params.impasto).f('uLightAng', params.light)
      .f('uGloss', params.gloss).f('uCanvas', params.canvas).f('uVignette', params.vignette)
      .f('uHueSky', params.hueSky).f('uHueLight', params.hueLight).f('uHueFoliage', params.hueFoliage).f('uHueAll', params.hueAll)
      .f('uSat', params.sat).f('uBright', params.bright).f('uContrast', params.contrast)
      .tex('uLic', licRT.tex, 0);
    pass(null, canvas.width, canvas.height);
  }

  // ------------------------------------------------------------------ sizing
  const panel = $('panel');
  function layout() {
    const panelW = panel.classList.contains('hidden') || window.innerWidth < 760 ? 0 : panel.offsetWidth;
    const availW = Math.max(200, window.innerWidth - panelW), availH = window.innerHeight;
    let cssW = availW, cssH = availW / ASPECT;
    if (cssH > availH) { cssH = availH; cssW = availH * ASPECT; }
    const stage = $('stage');
    stage.style.width = Math.floor(cssW) + 'px';
    stage.style.height = Math.floor(cssH) + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    resizeTargets(Math.min(2400, Math.round(cssW * dpr * params.scale)));
    positionHandles();
  }
  function resizeTargets(w) {
    w = Math.max(320, w);
    const h = Math.round(w / ASPECT);
    if (licRT && licRT.w === w) return;
    if (licRT) { gl.deleteTexture(licRT.tex); gl.deleteFramebuffer(licRT.fbo); }
    licRT = makeTarget(w, h, { filter: gl.LINEAR });
    canvas.width = w;
    canvas.height = h;
  }

  // ------------------------------------------------------------------ controls
  const sliderEls = {};
  function buildUI() {
    const host = $('sections');
    const groups = {};
    PARAMS.filter((p) => p.ui !== false).forEach((p) => (groups[p.group] = groups[p.group] || []).push(p));
    Object.keys(groups).forEach((g) => {
      const d = document.createElement('details');
      d.open = g !== 'Brush';
      d.innerHTML = `<summary>${g}</summary>`;
      if (g === 'Colour') {
        const pre = document.createElement('div');
        pre.className = 'presets';
        Object.keys(PRESETS).forEach((name) => {
          const b = document.createElement('button');
          b.textContent = name;
          b.addEventListener('click', () => applyPreset(name));
          pre.appendChild(b);
        });
        d.appendChild(pre);
      }
      groups[g].forEach((p) => {
        const row = document.createElement('label');
        row.className = 'row';
        row.innerHTML = `<span class="lab">${p.label}</span><output></output><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" autocomplete="off">`;
        const input = row.querySelector('input'), out = row.querySelector('output');
        const show = () => (out.textContent = (+params[p.id]).toFixed(p.step < 0.01 ? 3 : p.step < 1 ? 2 : 0));
        input.value = params[p.id];
        show();
        input.addEventListener('input', () => { params[p.id] = +input.value; show(); save(); });
        row.querySelector('.lab').addEventListener('dblclick', () => { params[p.id] = p.def; input.value = p.def; show(); save(); });
        sliderEls[p.id] = { input, show };
        d.appendChild(row);
      });
      host.appendChild(d);
    });
  }
  function setParam(id, v) { params[id] = v; const s = sliderEls[id]; if (s) { s.input.value = v; s.show(); } }
  function applyPreset(name) {
    COLOUR_IDS.forEach((id) => setParam(id, PARAMS.find((p) => p.id === id).def));
    Object.entries(PRESETS[name]).forEach(([k, v]) => setParam(k, v));
    save();
  }
  function syncChecks() {
    $('chkSim').checked = flags.simSky;
    $('chkEdit').checked = flags.edit;
    $('chkPause').checked = flags.paused;
    $('handles').hidden = !flags.edit;
    renderHandles();
    renderSelected();
  }

  // draggable handles for swirls (and stars / moon in simulated-sky mode)
  function renderHandles() {
    const host = $('handles');
    host.innerHTML = '';
    for (const e of entities) {
      if ((e.type === 'star' || e.type === 'moon') && !flags.simSky) continue;
      const h = document.createElement('div');
      h.className = 'handle ' + e.type + (e.id === selectedId ? ' sel' : '');
      h.dataset.id = e.id;
      h.title = e.name;
      host.appendChild(h);
      h.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selectedId = e.id;
        h.setPointerCapture(ev.pointerId);
        h._drag = true;
        document.querySelectorAll('.handle').forEach((x) => x.classList.toggle('sel', +x.dataset.id === selectedId));
        renderSelected();
      });
      h.addEventListener('pointermove', (ev) => {
        if (!h._drag) return;
        const r = $('stage').getBoundingClientRect();
        e.u = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
        e.v = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
        positionHandles();
      });
      h.addEventListener('pointerup', () => { h._drag = false; save(); });
    }
    positionHandles();
  }
  function positionHandles() {
    document.querySelectorAll('.handle').forEach((h) => {
      const e = entities.find((x) => x.id === +h.dataset.id);
      if (!e) return;
      h.style.left = e.u * 100 + '%';
      h.style.top = e.v * 100 + '%';
      const sz = e.type === 'swirl' ? Math.max(22, e.s * 2 * 100 * 6) : Math.max(16, (e.R || 0.04) * 2 * 100 * 6);
      h.style.width = h.style.height = Math.min(120, sz) + 'px';
    });
  }
  function renderSelected() {
    const box = $('selected');
    const e = entities.find((x) => x.id === selectedId);
    if (!e || !flags.edit) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="selname">${e.name}</div>`;
    const add = (label, min, max, step, get, set) => {
      const row = document.createElement('label');
      row.className = 'row';
      row.innerHTML = `<span class="lab">${label}</span><output></output><input type="range" min="${min}" max="${max}" step="${step}">`;
      const input = row.querySelector('input'), out = row.querySelector('output');
      input.value = get();
      out.textContent = (+get()).toFixed(2);
      input.addEventListener('input', () => { set(+input.value); out.textContent = (+input.value).toFixed(2); save(); });
      box.appendChild(row);
    };
    if (e.type === 'swirl') { add('Strength', -2.5, 2.5, 0.01, () => e.a, (v) => (e.a = v)); add('Size', 0.02, 0.4, 0.005, () => e.s, (v) => (e.s = v)); }
    else if (e.type === 'star') { add('Swirl', -1, 1, 0.01, () => e.a, (v) => (e.a = v)); add('Size', 0.015, 0.12, 0.001, () => e.R, (v) => (e.R = v)); }
    else if (e.type === 'moon') { add('Swirl', -1, 1, 0.01, () => e.a, (v) => (e.a = v)); add('Size', 0.03, 0.12, 0.001, () => e.R, (v) => (e.R = v)); }
    if (e.type === 'swirl' && entities.filter((x) => x.type === 'swirl').length > 1) {
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', () => { entities = entities.filter((x) => x.id !== e.id); selectedId = (entities[0] || {}).id; renderHandles(); renderSelected(); save(); });
      box.appendChild(del);
    }
  }
  function addSwirl(u, v) {
    const e = { id: nextId++, type: 'swirl', name: 'Swirl', u, v, s: 0.07, a: 0.8 };
    entities.push(e);
    selectedId = e.id;
    renderHandles();
    renderSelected();
    save();
  }

  // ------------------------------------------------------------------ mouse wind
  const stage = $('stage');
  let lastPtr = null;
  stage.addEventListener('pointermove', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('handle')) return;
    const r = stage.getBoundingClientRect();
    const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
    const t = performance.now();
    if (lastPtr) {
      const dt = Math.max(0.008, (t - lastPtr.t) / 1000);
      const vx = ((u - lastPtr.u) / dt) * ASPECT, vy = (v - lastPtr.v) / dt;
      gust.vx += (Math.max(-5, Math.min(5, vx)) * 14 - gust.vx) * 0.35;
      gust.vy += (Math.max(-5, Math.min(5, vy)) * 14 - gust.vy) * 0.35;
    }
    gust.u = u; gust.v = v;
    lastPtr = { u, v, t };
  });
  stage.addEventListener('pointerleave', () => { lastPtr = null; });
  stage.addEventListener('dblclick', (ev) => {
    if (!flags.edit || ev.target.classList.contains('handle')) return;
    const r = stage.getBoundingClientRect();
    addSwirl((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); flags.paused = !flags.paused; syncChecks(); }
    else if (k === 'h') { panel.classList.toggle('hidden'); layout(); }
    else if (k === 'e') { flags.edit = !flags.edit; syncChecks(); }
    else if (k === 's') savePNG();
  });

  // ------------------------------------------------------------------ save / reset
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function savePNG() {
    render();
    canvas.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'starry-night.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    toast('Saved');
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem('starry-night', JSON.stringify({ params, simSky: flags.simSky, entities })); } catch (e) { /* storage unavailable */ }
    }, 300);
  }
  function resetAll() {
    PARAMS.forEach((p) => setParam(p.id, p.def));
    entities = defaultEntities();
    selectedId = 1;
    flags.simSky = false;
    layout();
    syncChecks();
    save();
  }

  function wireButtons() {
    $('chkSim').addEventListener('change', (e) => { flags.simSky = e.target.checked; syncChecks(); save(); });
    $('chkEdit').addEventListener('change', (e) => { flags.edit = e.target.checked; syncChecks(); });
    $('chkPause').addEventListener('change', (e) => { flags.paused = e.target.checked; });
    $('addSwirl').addEventListener('click', () => { flags.edit = true; syncChecks(); addSwirl(0.5, 0.4); });
    $('savePng').addEventListener('click', savePNG);
    $('resetAll').addEventListener('click', resetAll);
    $('panelToggle').addEventListener('click', () => { panel.classList.toggle('hidden'); layout(); });
    window.addEventListener('resize', layout);
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now(), frames = 0, acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!flags.paused) simTime += dt * params.speed;
    const decay = Math.exp(-dt * 3.0);
    gust.vx *= decay; gust.vy *= decay;
    render();
    frames++; acc += dt;
    if (acc >= 1) {
      const fps = frames / acc;
      if (fps < 24 && params.scale > 0.45) { params.scale = Math.max(0.4, +(params.scale * 0.85).toFixed(2)); layout(); }
      frames = 0; acc = 0;
    }
  }

  SN.api = { params, flags, setParam, render, get entities() { return entities; } };

  async function boot() {
    buildUI();
    wireButtons();
    try {
      const saved = JSON.parse(localStorage.getItem('starry-night') || 'null');
      if (saved) {
        Object.keys(saved.params || {}).forEach((k) => { if (k in params && k !== 'scale') params[k] = saved.params[k]; });
        flags.simSky = !!saved.simSky;
        if (Array.isArray(saved.entities) && saved.entities.length) { entities = saved.entities; nextId = Math.max(...entities.map((e) => e.id || 0)) + 1; selectedId = entities[0].id; }
      }
    } catch (e) { /* ignore bad saved settings */ }
    Object.keys(sliderEls).forEach((id) => { sliderEls[id].input.value = params[id]; sliderEls[id].show(); });
    const [ref, scene, region] = await Promise.all([loadImage(SN_ASSETS.reference), loadImage(SN_ASSETS.scene), loadImage(SN_ASSETS.region)]);
    refTex = imageTex(ref);
    sceneTex = imageTex(scene);
    regionTex = imageTex(region, { filter: gl.NEAREST });
    layout();
    syncChecks();
    $('loading').classList.add('gone');
    requestAnimationFrame(frame);
  }
  boot().catch((e) => { console.error(e); fatal('Could not start: ' + e.message); });
})();

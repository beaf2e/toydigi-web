/* ToyDigi — 메인 앱 로직 (바닐라 JS) */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // 화질(LOFI) 단계 — res: 출력 해상도 배율, grain: 그레인 가중, vh: 영상 세로, fps/bitrate: 영상
  const LOFI = {
    sharp:   { res: 1.0,  grain: 0.6, vh: 720, fps: 30, bitrate: 6_000_000, blur: 0,    label: '선명' },
    normal:  { res: 0.8,  grain: 1.0, vh: 600, fps: 30, bitrate: 3_500_000, blur: 0,    label: '보통' },
    vintage: { res: 0.55, grain: 1.4, vh: 480, fps: 30, bitrate: 2_000_000, blur: 0.4,  label: '빈티지' },
    trashy:  { res: 0.4,  grain: 1.9, vh: 360, fps: 24, bitrate: 1_000_000, blur: 0.9,  label: '막구짐' },
    qvga:    { res: 0.3,  grain: 2.2, vh: 320, fps: 20, bitrate: 700_000,   blur: 1.2,  label: 'QVGA' }, // 영상 240×320(세로 QVGA = 320×240 회전)
  };

  const DEFAULT_SETTINGS = { date: true, sound: true, vibrate: true, mirror: true, mic: true, lofi: 'vintage' };

  // 촬영 비율 — 세로 3:4, 화면을 가로로 돌리면 가로 4:3 (가로:세로 = w/h)
  function aspectR() { return state.landscape ? 4 / 3 : 3 / 4; }
  const ZMIN = 1, ZMAX = 10, ZSP = 42; // 줌 범위 + 다이얼 1× 당 픽셀

  // ----- 상태 -----
  const state = {
    facing: 'environment',
    stream: null,
    audioStream: null,
    preset: PRESETS.find(p => p.id === 'ccd') || PRESETS[0],
    mode: 'photo',
    landscape: false,
    zoom: 1,
    frame: 0,
    camError: null,
    lastBlob: null, lastKind: 'photo', lastBlobUrl: null,
    settings: loadSettings(),
  };

  function loadSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('toydigi-settings') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettings() {
    try { localStorage.setItem('toydigi-settings', JSON.stringify(state.settings)); } catch (e) {}
  }

  // ----- 요소 -----
  const video = $('#video');
  const viewfinder = $('#viewfinder');
  const dateStamp = $('#dateStamp');
  const flash = $('#flash');
  const developing = $('#developing');
  const hudPreset = $('#hudPreset');
  const frameCountEl = $('#frameCount');
  const recordCanvas = $('#recordCanvas');
  const recBadge = $('#recBadge');
  const recTime = $('#recTime');
  const shutter = $('#shutter');

  const VIDEO_OK = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);

  // ================= 카메라 =================
  async function startCamera() {
    stopCamera();
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      video.srcObject = state.stream;
      await video.play().catch(() => {});
      applyPreviewTransform();
      state.camError = null;
      return true;
    } catch (err) { console.error(err); state.camError = err; return false; }
  }
  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    if (state.audioStream) { state.audioStream.getTracks().forEach(t => t.stop()); state.audioStream = null; }
  }
  async function ensureAudio() {
    if (state.audioStream || !state.settings.mic) return;
    try { state.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { state.audioStream = null; }
  }
  function applyPreviewTransform() {
    const lf = LOFI[state.settings.lofi];
    const soft = lf.blur ? ` blur(${lf.blur}px)` : '';
    video.style.filter = state.preset.css + soft;
    video.style.transform = (state.facing === 'user' ? 'scaleX(-1) ' : '') + `scale(${state.zoom})`;
  }

  // ================= 줌 (핀치 + 반원 다이얼) =================
  let zoomArcTimer = 0;
  const zoomTickVals = [];
  for (let v = ZMIN; v <= ZMAX + 0.001; v += 0.5) zoomTickVals.push(Math.round(v * 10) / 10);
  const fmtZoom = (z) => (Math.round(z * 10) / 10).toString().replace(/\.0$/, '') + '×';

  function buildZoomArc() {
    const dial = $('#zaDial'); if (!dial) return;
    dial.innerHTML = '';
    zoomTickVals.forEach(v => {
      const major = Math.abs(v - Math.round(v)) < 0.01;
      const t = document.createElement('div');
      t.className = 'za-tick' + (major ? ' major' : '');
      t.dataset.v = v;
      if (major && [1, 2, 3, 5, 10].includes(v)) {
        const l = document.createElement('span'); l.className = 'za-label'; l.textContent = v + '×'; t.appendChild(l);
      }
      dial.appendChild(t);
    });
  }
  function renderZoomArc() {
    const cx = 140;
    $$('#zaDial .za-tick').forEach(t => {
      const v = parseFloat(t.dataset.v);
      const dx = (v - state.zoom) * ZSP;
      if (Math.abs(dx) > cx) { t.style.display = 'none'; return; }
      t.style.display = 'block';
      const y = (dx / cx) * (dx / cx) * 22;
      t.style.transform = `translate(${dx}px,${y}px) rotate(${(dx / cx) * 14}deg)`;
      t.classList.toggle('on', Math.abs(v - state.zoom) < 0.26);
    });
    const zv = $('#zaValue'); if (zv) zv.textContent = fmtZoom(state.zoom);
    const zq = $('#zoomQuick'); if (zq) zq.textContent = fmtZoom(state.zoom);
  }
  function showZoomArc() {
    const a = $('#zoomArc'); if (!a) return;
    a.classList.remove('hidden');
    clearTimeout(zoomArcTimer);
    zoomArcTimer = setTimeout(() => a.classList.add('hidden'), 1400);
  }
  function setZoom(z, arc = true) {
    state.zoom = Math.min(ZMAX, Math.max(ZMIN, z));
    applyPreviewTransform();
    renderZoomArc();
    if (arc) showZoomArc();
  }

  // 버튼/레이아웃은 그대로 두고, 프리뷰만 남는 공간(뷰포트 − 상단바 − 독)에 현재 비율로 맞춤
  function fitViewfinder() {
    const topbar = document.querySelector('.topbar');
    const dock = document.querySelector('.dock');
    if (!topbar || !dock) return;
    const R = aspectR();
    let availW, availH;
    if (state.landscape) {            // 그리드의 stage 셀(프리뷰 영역)에 맞춤
      const stage = document.querySelector('.stage');
      availW = (stage ? stage.clientWidth : window.innerWidth) - 12;
      availH = (stage ? stage.clientHeight : window.innerHeight) - 12;
    } else {                          // 상단바/독 = 세로로 쌓임 (필터는 트레이로 이동)
      availW = window.innerWidth - 8;
      availH = window.innerHeight - topbar.offsetHeight - dock.offsetHeight - 8;
    }
    if (availW <= 0 || availH <= 0) return;
    let w, h;
    if (availW / availH > R) { h = availH; w = h * R; } else { w = availW; h = w / R; }
    const MAXW = 720;
    if (w > MAXW) { h *= MAXW / w; w = MAXW; }
    viewfinder.style.width = Math.floor(w) + 'px';
    viewfinder.style.height = Math.floor(h) + 'px';
  }

  function updateOrientation() {
    const ls = window.innerWidth > window.innerHeight;
    if (ls !== state.landscape) {
      state.landscape = ls;
      document.body.classList.toggle('landscape', ls);
      kitKey = null;
    }
    fitViewfinder();
  }

  // ===== 아이폰 기본 카메라 방식: 회전잠금 중 기기를 옆으로 들면 버튼/글자만 회전 (가속도계) =====
  let uiRot = 0;
  function setUiRot(r) {
    if (r === uiRot) return;
    uiRot = r;
    document.documentElement.style.setProperty('--ui-rot', r + 'deg');
    document.body.classList.toggle('ui-rot', r !== 0);
  }
  function onTilt(e) {
    const g = e.gamma; if (g == null) return;
    const viewportLandscape = window.innerWidth > window.innerHeight;
    let r = 0;
    if (!viewportLandscape) {            // 화면은 세로(회전잠금)인데 기기를 옆으로 → 버튼만 회전
      if (g > 35) r = 90;
      else if (g < -35) r = -90;
    }
    setUiRot(r);
  }
  async function enableTilt() {
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();   // iOS: 제스처에서 권한
        if (res !== 'granted') return;
      }
      if (window.DeviceOrientationEvent) window.addEventListener('deviceorientation', onTilt);
    } catch (e) {}
  }
  function rotateCanvas(src, deg) {
    const c = document.createElement('canvas');
    if (Math.abs(deg) === 90) { c.width = src.height; c.height = src.width; } else { c.width = src.width; c.height = src.height; }
    const x = c.getContext('2d');
    x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180);
    x.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  // ================= 프리셋 =================
  let kitKey = null, kit = null; // 캡처/녹화용 오버레이 캐시
  function applyPreset(p) {
    state.preset = p;
    if (hudPreset) {
      hudPreset.textContent = p.name;
      hudPreset.classList.remove('show'); void hudPreset.offsetWidth; hudPreset.classList.add('show');
    }
    const fq = $('#filterQuick'); if (fq) fq.textContent = p.name;
    applyPreviewTransform();
    kitKey = null;

    const vf = viewfinder;
    vf.style.setProperty('--vignette', p.vignette);
    vf.style.setProperty('--grain-opacity', p.grain);
    vf.style.setProperty('--scanline-opacity', p.scanline);
    vf.style.setProperty('--leak-alpha', p.leak || 0);
    if (p.tint) {
      vf.style.setProperty('--tint-color', p.tint.color);
      vf.style.setProperty('--tint-alpha', p.tint.alpha);
      vf.style.setProperty('--tint-blend', p.tint.blend);
    } else { vf.style.setProperty('--tint-alpha', 0); }
    vf.classList.toggle('polaroid', p.border === 'polaroid');

    updateDateStamp();
    renderPresetBar();
  }

  function renderPresetBar() {
    const bar = $('#presetBar');
    bar.innerHTML = '';
    PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'preset' + (p.id === state.preset.id ? ' active' : '');
      b.innerHTML = `<span class="pn">${p.name}</span><span class="pf">${p.family}</span>`;
      b.title = p.desc;
      b.onclick = () => { applyPreset(p); b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); buzz(8); };
      bar.appendChild(b);
    });
    const active = bar.querySelector('.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  // ================= 날짜 각인 =================
  const two = (n) => String(n).padStart(2, '0');
  function dateText() { const d = new Date(); return `${d.getFullYear()} ${two(d.getMonth() + 1)} ${two(d.getDate())}`; }
  function updateDateStamp() {
    if (!state.settings.date) { dateStamp.style.display = 'none'; return; }
    dateStamp.style.display = 'block';
    dateStamp.textContent = dateText();
  }

  // ================= 셔터음 + 진동 =================
  let audioCtx = null;
  function ensureAudioCtx() {                 // iOS는 suspended로 시작 → 제스처에서 resume 필요
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function shutterSound() {
    if (!state.settings.sound) return;
    try {
      ensureAudioCtx();
      const t = audioCtx.currentTime;
      const click = audioCtx.createOscillator(); const cg = audioCtx.createGain();
      click.type = 'square'; click.frequency.value = 2400;
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      click.connect(cg).connect(audioCtx.destination); click.start(t); click.stop(t + 0.06);
      const dur = 0.08, buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const noise = audioCtx.createBufferSource(); noise.buffer = buf;
      const ng = audioCtx.createGain(); ng.gain.value = 0.18;
      const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
      noise.connect(hp).connect(ng).connect(audioCtx.destination); noise.start(t + 0.03);
    } catch (e) {}
  }
  function beep(freq, dur) {
    if (!state.settings.sound) return;
    try {
      ensureAudioCtx();
      const t = audioCtx.currentTime; const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  function buzz(ms) { if (state.settings.vibrate && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

  // ================= 렌더 파이프라인 (사진/영상 공용) =================
  function makeGrainCanvas(w, h, amount) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ictx = c.getContext('2d'); const img = ictx.createImageData(w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 90;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 * amount;
    }
    ictx.putImageData(img, 0, 0); return c;
  }

  function computeCrop() {
    const vw = video.videoWidth, vh = video.videoHeight, R = aspectR();
    let cw, ch;
    if (vw / vh > R) { ch = vh; cw = vh * R; } else { cw = vw; ch = vw / R; }
    cw /= state.zoom; ch /= state.zoom;
    return { sx: (vw - cw) / 2, sy: (vh - ch) / 2, sw: cw, sh: ch, vw, vh, R };
  }

  // 프리셋·크기별 오버레이(비네팅/스캔라인/그레인) 캐시
  function getKit(p, w, h, grainMul) {
    const key = `${p.id}|${w}x${h}|${grainMul.toFixed(2)}`;
    if (kitKey === key && kit) return kit;
    let vig = null;
    if (p.vignette > 0) {
      vig = document.createElement('canvas'); vig.width = w; vig.height = h;
      const c = vig.getContext('2d');
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${p.vignette})`);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    let scan = null;
    if (p.scanline > 0) {
      scan = document.createElement('canvas'); scan.width = w; scan.height = h;
      const c = scan.getContext('2d'); c.fillStyle = `rgba(0,0,0,${p.scanline * 0.5})`;
      for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
    }
    const tiles = [];
    const ga = Math.min(0.5, p.grain * grainMul);
    if (ga > 0) {
      const tw = Math.max(2, Math.round(w / 2)), th = Math.max(2, Math.round(h / 2));
      for (let k = 0; k < 3; k++) tiles.push(makeGrainCanvas(tw, th, ga));
    }
    kitKey = key; kit = { vig, scan, tiles }; return kit;
  }

  // 한 프레임을 색보정+오버레이로 그려넣는다
  function drawFrame(ctx, w, h, p, opts) {
    const { crop, mirror, grainMul, frameIndex, bloom } = opts;
    ctx.save();
    if ('filter' in ctx) ctx.filter = p.css;
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    ctx.restore();

    if (p.tint && p.tint.alpha > 0) {
      ctx.save();
      ctx.globalCompositeOperation = p.tint.blend === 'soft-light' ? 'soft-light' : (p.tint.blend || 'soft-light');
      ctx.globalAlpha = Math.min(1, p.tint.alpha * 2.2);
      ctx.fillStyle = p.tint.color; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
    if (bloom && 'filter' in ctx) {
      if (p.bloom > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.bloom * 0.5;
        ctx.filter = 'brightness(1.6) blur(6px)'; ctx.drawImage(ctx.canvas, 0, 0, w, h); ctx.restore();
      }
      if (p.halation > 0) { // 하이라이트 둘레 따뜻한 글로우
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.halation * 0.6;
        ctx.filter = 'brightness(1.7) blur(9px) sepia(0.7) saturate(2.2) hue-rotate(-12deg)';
        ctx.drawImage(ctx.canvas, 0, 0, w, h); ctx.restore();
      }
    }
    // 색수차 (픽셀 단위 — 캡처 전용, 영상 루프에선 생략)
    if (bloom && p.chroma > 0) {
      const d = Math.max(1, Math.round(w * 0.0035 * p.chroma * 3));
      try {
        const src = ctx.getImageData(0, 0, w, h), out = ctx.createImageData(w, h);
        const s = src.data, o = out.data;
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const i = (row + x) * 4;
            o[i] = s[(row + Math.min(w - 1, x + d)) * 4];
            o[i + 1] = s[i + 1];
            o[i + 2] = s[(row + Math.max(0, x - d)) * 4 + 2];
            o[i + 3] = s[i + 3];
          }
        }
        ctx.putImageData(out, 0, 0);
      } catch (e) {}
    }
    // 라이트릭 (사진·영상 공통)
    if (p.leak > 0) {
      const lx = w * 0.9, ly = h * 0.12;
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.65);
      g.addColorStop(0, `rgba(255,135,45,${0.55 * p.leak})`);
      g.addColorStop(0.4, `rgba(255,60,80,${0.22 * p.leak})`);
      g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
    const k = getKit(p, w, h, grainMul);
    if (k.scan) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(k.scan, 0, 0); ctx.restore(); }
    if (k.tiles.length) {
      ctx.save(); ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(k.tiles[frameIndex % k.tiles.length], 0, 0, w, h); ctx.restore();
    }
    if (k.vig) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(k.vig, 0, 0); ctx.restore(); }

    if (state.settings.date) {
      const txt = dateText(); const fs = Math.round(w * 0.045);
      ctx.save();
      ctx.font = `${fs}px "VT323", monospace`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ff9a2e'; ctx.shadowColor = 'rgba(255,120,0,0.9)'; ctx.shadowBlur = fs * 0.5;
      ctx.fillText(txt, w - fs * 0.6, h - fs * 0.5); ctx.restore();
    }
  }

  // ================= 사진 캡처 =================
  function capturePhoto() {
    const crop = computeCrop(); if (!crop.vw) return null;
    const p = state.preset, lf = LOFI[state.settings.lofi], R = crop.R;
    let shortPx = Math.round(Math.min(crop.sw, crop.sh));
    shortPx = Math.round(Math.min(1200, shortPx) * (1 - (p.lofi || 0) * 0.4) * lf.res);
    shortPx = Math.max(240, shortPx);
    const outW = R >= 1 ? Math.round(shortPx * R) : shortPx;
    const outH = R >= 1 ? shortPx : Math.round(shortPx / R);

    const canvas = document.createElement('canvas'); canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    kitKey = null; // 캡처는 캡처 해상도 그레인으로 새로 생성
    drawFrame(ctx, outW, outH, p, {
      crop, mirror: state.facing === 'user' && state.settings.mirror,
      grainMul: lf.grain, frameIndex: 0, bloom: true,
    });
    kitKey = null; // 다음 녹화/프리뷰용으로 캐시 무효화

    let out = canvas;
    if (p.border === 'polaroid') {
      const pad = Math.round(outW * 0.05), bottom = Math.round(outW * 0.18);
      const fc = document.createElement('canvas'); fc.width = outW + pad * 2; fc.height = outH + pad + bottom;
      const fx = fc.getContext('2d'); fx.fillStyle = '#f6f4ec'; fx.fillRect(0, 0, fc.width, fc.height);
      fx.drawImage(canvas, pad, pad); out = fc;
    }
    if (uiRot) out = rotateCanvas(out, uiRot);   // 기기를 옆으로 들고 찍으면 사진도 회전(가로 저장)
    return out;
  }

  // 토스트 (에러/알림)
  let toastTimer = 0;
  function toast(msg) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  // 컷에 저장할 메타데이터 (프리셋·화질·줌·전후면)
  function metaNow(extra) {
    const lf = LOFI[state.settings.lofi];
    return Object.assign({ lofi: state.settings.lofi, lofiLabel: lf.label, zoom: Math.round(state.zoom * 10) / 10, facing: state.facing }, extra || {});
  }

  async function takePhoto() {
    buzz([6, 4, 10]); shutterSound();
    flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 140);
    viewfinder.classList.add('snap'); setTimeout(() => viewfinder.classList.remove('snap'), 220);
    const canvas = capturePhoto(); if (!canvas) return;
    developing.classList.remove('hidden');
    state.frame++; frameCountEl.textContent = String(state.frame).padStart(3, '0');
    canvas.toBlob(async (blob) => {
      if (!blob) { developing.classList.add('hidden'); toast('사진 저장에 실패했어요'); return; }
      try { await DB.add(blob, state.preset.name, 'photo', metaNow()); setLastThumb(blob); }
      catch (e) { toast(e && e.name === 'QuotaExceededError' ? '저장공간이 부족해요 · 필름롤을 정리해 주세요' : '저장 실패'); }
      showResult(blob, 'photo');
      setTimeout(() => developing.classList.add('hidden'), 650);
    }, 'image/jpeg', 0.9);
  }

  // ================= 영상 녹화 =================
  let recorder = null, recording = false, rafId = 0, recTimer = 0, recStart = 0, recChunks = [], recMime = '';
  const MAX_SEC = 60;

  function pickMime() {
    const cands = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return '';
  }

  async function startRecording() {
    if (!VIDEO_OK) { alert('이 브라우저는 영상 녹화를 지원하지 않아요.'); return; }
    await ensureAudio();
    const crop = computeCrop(); if (!crop.vw) return;
    const lf = LOFI[state.settings.lofi], R = aspectR();
    const long = lf.vh, short = Math.round(long * 3 / 4);
    const w = R >= 1 ? long : short, h = R >= 1 ? short : long;
    recordCanvas.width = w; recordCanvas.height = h;
    const rctx = recordCanvas.getContext('2d');
    kitKey = null;
    let frame = 0, lastT = 0;
    const minDelta = 1000 / lf.fps;
    const loop = (t) => {
      if (!recording) return;
      rafId = requestAnimationFrame(loop);
      if (t - lastT < minDelta) return;   // lf.fps로 스로틀 → 버리는 프레임 안 그림(배터리↓)
      lastT = t;
      const c = computeCrop();
      if (c.vw) drawFrame(rctx, w, h, state.preset, {
        crop: c, mirror: state.facing === 'user' && state.settings.mirror,
        grainMul: lf.grain, frameIndex: frame++, bloom: false,
      });
    };

    const vstream = recordCanvas.captureStream(lf.fps);
    if (state.settings.mic && state.audioStream) {
      state.audioStream.getAudioTracks().forEach(t => vstream.addTrack(t));
    }
    recMime = pickMime();
    try {
      recorder = recMime
        ? new MediaRecorder(vstream, { mimeType: recMime, videoBitsPerSecond: lf.bitrate })
        : new MediaRecorder(vstream, { videoBitsPerSecond: lf.bitrate });
    } catch (e) { recorder = new MediaRecorder(vstream); }
    recMime = recorder.mimeType || recMime || 'video/webm';
    recChunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = onRecStop;

    recording = true;
    shutter.classList.add('rec');
    viewfinder.classList.add('recording');
    recBadge.classList.remove('hidden');
    recStart = performance.now();
    updateRecTime();
    recTimer = setInterval(updateRecTime, 500);
    rafId = requestAnimationFrame(loop);
    recorder.start(250);
    beep(880, 0.08); buzz(20);
  }

  function updateRecTime() {
    const s = Math.floor((performance.now() - recStart) / 1000);
    recTime.textContent = `${Math.floor(s / 60)}:${two(s % 60)}`;
    if (s >= MAX_SEC) stopRecording();
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    clearInterval(recTimer);
    cancelAnimationFrame(rafId);
    shutter.classList.remove('rec');
    viewfinder.classList.remove('recording');
    recBadge.classList.add('hidden');
    beep(440, 0.1); buzz([10, 30, 10]);
    try { recorder.stop(); } catch (e) {}
  }

  async function onRecStop() {
    let poster = '';
    try { poster = recordCanvas.toDataURL('image/jpeg', 0.6); } catch (e) {}
    const blob = new Blob(recChunks, { type: recMime });
    recChunks = [];
    if (!blob.size) return;
    state.frame++; frameCountEl.textContent = String(state.frame).padStart(3, '0');
    try { await DB.add(blob, state.preset.name, 'video', metaNow({ poster })); setVideoThumb(blob); }
    catch (e) { toast(e && e.name === 'QuotaExceededError' ? '저장공간이 부족해요 · 필름롤을 정리해 주세요' : '저장 실패'); }
    showResult(blob, 'video');
  }

  // ================= 결과 / 썸네일 =================
  function showResult(blob, kind) {
    if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
    state.lastBlob = blob; state.lastKind = kind;
    state.lastBlobUrl = URL.createObjectURL(blob);
    const img = $('#resultImg'), vid = $('#resultVideo');
    if (kind === 'video') {
      img.classList.add('hidden'); vid.classList.remove('hidden');
      vid.src = state.lastBlobUrl; vid.play().catch(() => {});
    } else {
      vid.classList.add('hidden'); vid.removeAttribute('src'); img.classList.remove('hidden');
      img.src = state.lastBlobUrl;
    }
    showScreen('result');
  }
  function setLastThumb(blob) {
    const url = URL.createObjectURL(blob);
    $('#lastThumb').innerHTML = `<img src="${url}" alt="">`;
  }
  function setVideoThumb(blob) {
    const url = URL.createObjectURL(blob);
    $('#lastThumb').innerHTML = `<video src="${url}" muted playsinline></video>`;
  }

  // ================= 저장 / 공유 =================
  function fname(kind, mime) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const ext = kind === 'video' ? (/mp4/.test(mime || '') ? 'mp4' : 'webm') : 'jpg';
    return `ToyDigi_${stamp}.${ext}`;
  }
  async function saveBlob(blob, name) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'ToyDigi' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ================= 갤러리 =================
  let galleryUrls = [];
  let gallerySelect = false;
  const gallerySel = new Set();
  let galleryIO = null;
  function revokeGalleryUrls() { galleryUrls.forEach(u => URL.revokeObjectURL(u)); galleryUrls = []; }

  function setSelectMode(on) {
    gallerySelect = on; gallerySel.clear();
    document.body.classList.toggle('gallery-select', on);
    $$('#galleryGrid .g-cell').forEach(c => c.classList.remove('sel'));
    updateGalleryHead();
  }
  function updateGalleryHead() {
    const sel = $('#gallerySelectBtn'), del = $('#gallerySelDel');
    if (!sel) return;
    sel.textContent = gallerySelect ? '취소' : '선택';
    del.classList.toggle('hidden', !gallerySelect);
    del.textContent = `삭제 (${gallerySel.size})`;
  }

  // 셀이 화면에 들어올 때만 썸네일 로드 (레이지). 영상은 저장된 포스터 1프레임 사용
  function loadCell(cell) {
    const it = cell._rec; if (!it || cell._loaded) return; cell._loaded = true;
    const tag = `<span class="g-tag">${it.preset || ''}</span>`;
    if (it.kind === 'video') {
      const poster = it.meta && it.meta.poster;
      cell.innerHTML = (poster ? `<img src="${poster}" alt="">` : `<span class="g-noposter"></span>`) + `<span class="g-play">▶</span>` + tag;
    } else {
      const url = URL.createObjectURL(it.blob); galleryUrls.push(url);
      cell.innerHTML = `<img src="${url}" alt="">` + tag;
    }
  }

  async function openGallery() {
    revokeGalleryUrls();
    if (gallerySelect) setSelectMode(false);
    const grid = $('#galleryGrid'); grid.innerHTML = '';
    if (galleryIO) galleryIO.disconnect();
    galleryIO = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { loadCell(en.target); galleryIO.unobserve(en.target); } });
    }, { root: grid, rootMargin: '250px' });

    let items = [];
    try { items = await DB.all(); } catch (e) { toast('필름롤을 불러오지 못했어요'); }
    $('#galleryEmpty').style.display = items.length ? 'none' : 'block';
    $('#galleryCount').textContent = items.length ? `${items.length}컷` : '';
    items.forEach(it => {
      const cell = document.createElement('button'); cell.className = 'g-cell';
      cell._rec = it;
      cell.innerHTML = `<span class="g-ph"></span>`;
      cell.onclick = () => {
        if (gallerySelect) {
          if (gallerySel.has(it.id)) { gallerySel.delete(it.id); cell.classList.remove('sel'); }
          else { gallerySel.add(it.id); cell.classList.add('sel'); }
          updateGalleryHead();
        } else {
          const url = it.kind === 'video'
            ? URL.createObjectURL(it.blob)
            : (cell.querySelector('img') ? cell.querySelector('img').src : URL.createObjectURL(it.blob));
          openViewer(it, url);
        }
      };
      grid.appendChild(cell);
      galleryIO.observe(cell);
    });
    showScreen('gallery');
  }

  let viewerCur = null, viewerUrl = null;
  function openViewer(rec, url) {
    viewerCur = rec; viewerUrl = url;
    const img = $('#viewerImg'), vid = $('#viewerVideo');
    if (rec.kind === 'video') {
      img.classList.add('hidden'); vid.classList.remove('hidden'); vid.src = url; vid.play().catch(() => {});
    } else {
      vid.classList.add('hidden'); vid.removeAttribute('src'); img.classList.remove('hidden'); img.src = url;
    }
    const m = rec.meta || {};
    const d = new Date(rec.ts || Date.now());
    const parts = [rec.preset, m.lofiLabel, m.zoom ? m.zoom + '×' : null,
      `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())}`].filter(Boolean);
    const mEl = $('#viewerMeta'); if (mEl) mEl.textContent = parts.join('  ·  ');
    showScreen('viewer');
  }

  // ================= 설정 UI =================
  function syncSettingsUI() {
    $$('.sw').forEach(b => b.classList.toggle('on', !!state.settings[b.dataset.set]));
    $$('#lofiSeg button').forEach(b => b.classList.toggle('active', b.dataset.lofi === state.settings.lofi));
  }
  function setTrayTab(name) {
    $$('#trayTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tray-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  }
  function openTray(tab) { if (tab) setTrayTab(tab); syncSettingsUI(); $('#settings').classList.remove('hidden'); }
  function closeSettings() { $('#settings').classList.add('hidden'); }

  // ================= 화면 전환 =================
  function showScreen(name) {
    ['start', 'camera', 'result', 'gallery', 'viewer'].forEach(s => {
      $('#' + s).classList.toggle('hidden', s !== name);
    });
    document.body.classList.toggle('cam-live', name === 'camera'); // grain 애니는 카메라 화면에서만
  }

  // ================= 모드 =================
  function setMode(m) {
    state.mode = m;
    $$('#modeSeg .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    $('#modeSeg').classList.toggle('video', m === 'video');
    shutter.classList.toggle('video', m === 'video');
    buzz(8);
  }

  // ================= 이벤트 =================
  function camErrorInfo(err) {
    if (!window.isSecureContext) return { msg: 'HTTPS에서만 카메라를 쓸 수 있어요.', steps: ['주소가 https:// 로 시작하는지 확인하세요.'], reload: true };
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return {
      msg: '카메라 권한이 거부됐어요.',
      steps: ['Safari 주소창 왼쪽 「ᴀA」 → 웹사이트 설정 → 카메라 → 「허용」', '또는 설정 앱 ▸ Safari ▸ 카메라 ▸ 「허용」', '바꾼 뒤 아래 「새로고침」을 눌러주세요.'],
      reload: true };
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return { msg: '카메라를 찾을 수 없어요.', steps: ['기기에 카메라가 있는지 확인해 주세요.'], reload: false };
    if (n === 'NotReadableError') return { msg: '다른 앱이 카메라를 사용 중이에요.', steps: ['카메라를 쓰는 다른 앱을 닫고 다시 시도해 주세요.'], reload: false };
    return { msg: '카메라를 켤 수 없어요.', steps: ['잠시 후 다시 시도해 주세요.'], reload: true };
  }
  function showCamError(err) {
    const info = camErrorInfo(err);
    $('#startHint').textContent = info.msg;
    const g = $('#startGuide');
    g.innerHTML = '<ul class="guide-steps">' + info.steps.map(s => `<li>${s}</li>`).join('') + '</ul>' +
      (info.reload ? '<button id="reloadBtn" class="btn-outline">새로고침</button>' : '');
    g.classList.remove('hidden');
    const rb = $('#reloadBtn'); if (rb) rb.onclick = () => location.reload();
    $('#startBtn').textContent = '다시 시도';
  }

  $('#startBtn').onclick = async () => {
    $('#startHint').textContent = '카메라 켜는 중…';
    $('#startGuide').classList.add('hidden');
    const ok = await startCamera();
    if (!ok) { showCamError(state.camError); return; }
    showScreen('camera');
    enableTilt();           // 기기 기울기 감지(아이폰식 버튼 회전) — 제스처에서 권한 요청
    updateOrientation();
    buildZoomArc();
    applyPreset(state.preset);
    setZoom(1, false);
    requestAnimationFrame(fitViewfinder);
    if (!VIDEO_OK) $('#modeSeg').querySelector('[data-mode=video]').style.display = 'none';
    setInterval(updateDateStamp, 30000);
  };

  shutter.onclick = () => {
    if (state.mode === 'video') { recording ? stopRecording() : startRecording(); }
    else takePhoto();
  };

  $('#flipBtn').onclick = async () => {
    if (recording) stopRecording();
    state.facing = state.facing === 'environment' ? 'user' : 'environment';
    await startCamera(); applyPreset(state.preset); buzz(10);
  };

  // 핀치 줌 (두 손가락)
  const ptrs = new Map();
  let pinchD0 = 0, pinchZ0 = 1;
  const dist2 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  viewfinder.addEventListener('pointerdown', (e) => {
    ptrs.set(e.pointerId, e);
    if (ptrs.size === 2) { const p = [...ptrs.values()]; pinchD0 = dist2(p[0], p[1]); pinchZ0 = state.zoom; }
  });
  viewfinder.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e);
    if (ptrs.size === 2 && pinchD0) { const p = [...ptrs.values()]; setZoom(pinchZ0 * dist2(p[0], p[1]) / pinchD0); }
  });
  const ptrUp = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinchD0 = 0; };
  viewfinder.addEventListener('pointerup', ptrUp);
  viewfinder.addEventListener('pointercancel', ptrUp);
  viewfinder.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.08 : 0.926)); }, { passive: false });

  // 줌 다이얼 드래그
  const arcEl = $('#zoomArc');
  let arcX0 = 0, arcZ0 = 1, arcDrag = false;
  arcEl.addEventListener('pointerdown', (e) => { arcDrag = true; arcX0 = e.clientX; arcZ0 = state.zoom; arcEl.setPointerCapture(e.pointerId); });
  arcEl.addEventListener('pointermove', (e) => { if (arcDrag) setZoom(arcZ0 - (e.clientX - arcX0) / ZSP); });
  arcEl.addEventListener('pointerup', () => { arcDrag = false; });

  // 줌 퀵 버튼: 1→2→5→10→1
  $('#zoomQuick').onclick = () => { const stops = [1, 2, 5, 10]; setZoom(stops.find(s => s > state.zoom + 0.05) ?? 1); buzz(8); };

  window.addEventListener('resize', updateOrientation);
  window.addEventListener('orientationchange', () => setTimeout(updateOrientation, 250));

  $$('#modeSeg .mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  $('#settingsBtn').onclick = () => openTray('setting');
  $('#filterQuick').onclick = () => openTray('filter');
  $$('#trayTabs button').forEach(b => b.onclick = () => setTrayTab(b.dataset.tab));
  $('#settingsClose').onclick = closeSettings;
  $('#settings').onclick = (e) => { if (e.target.id === 'settings') closeSettings(); };
  $$('.sw').forEach(b => b.onclick = () => {
    const k = b.dataset.set; state.settings[k] = !state.settings[k];
    b.classList.toggle('on', state.settings[k]);
    saveSettings();
    if (k === 'date') updateDateStamp();
    if (k === 'lofi' || k === 'mirror') { kitKey = null; applyPreviewTransform(); }
    buzz(8);
  });
  $$('#lofiSeg button').forEach(b => b.onclick = () => {
    state.settings.lofi = b.dataset.lofi; saveSettings();
    syncSettingsUI(); kitKey = null; applyPreviewTransform(); buzz(8);
  });

  $('#galleryBtn').onclick = openGallery;
  $('#galleryClose').onclick = () => { if (gallerySelect) setSelectMode(false); revokeGalleryUrls(); showScreen('camera'); };
  $('#gallerySelectBtn').onclick = () => setSelectMode(!gallerySelect);
  $('#gallerySelDel').onclick = async () => {
    if (!gallerySel.size) return;
    if (!confirm(`${gallerySel.size}개를 삭제할까요?`)) return;
    for (const id of [...gallerySel]) { try { await DB.remove(id); } catch (e) {} }
    setSelectMode(false); openGallery();
  };

  $('#retakeBtn').onclick = () => { const v = $('#resultVideo'); v.pause(); v.removeAttribute('src'); showScreen('camera'); };
  $('#saveBtn').onclick = () => state.lastBlob && saveBlob(state.lastBlob, fname(state.lastKind, state.lastBlob.type));

  $('#viewerClose').onclick = () => { $('#viewerVideo').pause(); if (viewerCur && viewerCur.kind === 'video' && viewerUrl) URL.revokeObjectURL(viewerUrl); openGallery(); };
  $('#viewerSave').onclick = () => viewerCur && saveBlob(viewerCur.blob, fname(viewerCur.kind, viewerCur.blob.type));
  $('#viewerDelete').onclick = async () => { if (viewerCur) { try { await DB.remove(viewerCur.id); } catch (e) {} if (viewerCur.kind === 'video' && viewerUrl) URL.revokeObjectURL(viewerUrl); openGallery(); } };

  // 키보드(데스크탑): 스페이스=촬영/녹화, F=전환, V=모드
  window.addEventListener('keydown', (e) => {
    if (!$('#camera') || $('#camera').classList.contains('hidden')) return;
    if (e.code === 'Space') { e.preventDefault(); shutter.click(); }
    if (e.key === 'f') $('#flipBtn').click();
    if (e.key === 'v' && VIDEO_OK) setMode(state.mode === 'photo' ? 'video' : 'photo');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (recording) stopRecording(); stopCamera(); }
    else if (!$('#camera').classList.contains('hidden') && !state.stream) startCamera();
  });

  // 서비스워커: 배포 환경에서만 등록. localhost(개발)에선 캐시 꼬임 방지 위해 기존 등록 해제
  const isLocal = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
  if ('serviceWorker' in navigator) {
    if (isLocal) {
      navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    } else {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  // ================= 셀프테스트 (?selftest) =================
  async function runSelfTest() {
    const log = [];
    window.addEventListener('error', (e) => log.push('ERR:' + e.message));
    try {
      const tc = document.createElement('canvas'); tc.width = 640; tc.height = 480;
      const tx = tc.getContext('2d');
      const draw = () => {
        const g = tx.createLinearGradient(0, 0, 640, 480);
        g.addColorStop(0, '#6db3ff'); g.addColorStop(0.5, '#ffd27f'); g.addColorStop(1, '#ff6f91');
        tx.fillStyle = g; tx.fillRect(0, 0, 640, 480);
        tx.fillStyle = '#fff'; tx.fillRect(60, 60, 180, 180);
        tx.fillStyle = '#111'; tx.fillRect(360, 240, 200, 160);
        tx.fillStyle = '#1f8a5b'; tx.beginPath(); tx.arc(480, 130, 70, 0, 7); tx.fill();
      };
      draw(); video.srcObject = tc.captureStream(15); await video.play().catch(() => {}); draw();
      log.push('video=' + video.videoWidth + 'x' + video.videoHeight);
      showScreen('camera'); updateOrientation(); buildZoomArc(); applyPreset(state.preset);
      log.push('landscape=' + state.landscape + ' aspectR=' + aspectR().toFixed(3));
      let ok = 0; for (const p of PRESETS) { applyPreset(p); const c = capturePhoto(); if (c && c.width) ok++; else log.push('photoFail=' + p.id); }
      log.push('photos=' + ok + '/' + PRESETS.length);
      log.push('videoSupport=' + VIDEO_OK + ' mime=' + (VIDEO_OK ? pickMime() : '-'));
      log.push('captureStream=' + (typeof recordCanvas.captureStream === 'function'));
      if (VIDEO_OK) {
        try {
          recordCanvas.width = 320; recordCanvas.height = 240;
          const rc = recordCanvas.getContext('2d'); const st = recordCanvas.captureStream(15);
          const mime = pickMime();
          const mr = mime ? new MediaRecorder(st, { mimeType: mime }) : new MediaRecorder(st);
          const chunks = []; mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          const done = new Promise(r => { mr.onstop = r; }); mr.start();
          for (let i = 0; i < 8; i++) { const cc = computeCrop(); if (cc.vw) drawFrame(rc, 320, 240, state.preset, { crop: cc, mirror: false, grainMul: 1, frameIndex: i, bloom: false }); await new Promise(r => setTimeout(r, 60)); }
          mr.stop(); await done;
          const b = new Blob(chunks, { type: mime || 'video/webm' });
          log.push('recBlob=' + b.size + 'B type=' + b.type);
        } catch (e) { log.push('recErr:' + (e && e.message)); }
      }
      const c = capturePhoto();
      if (c) { log.push('out=' + c.width + 'x' + c.height); const px = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; log.push('px=' + px.join(',')); }
    } catch (e) { log.push('THROW:' + (e && e.message)); }
    document.title = 'SELFTEST ' + JSON.stringify(log);
    const el = document.createElement('pre'); el.id = 'selftest-result'; el.textContent = JSON.stringify(log, null, 1);
    el.style.cssText = 'position:fixed;z-index:99999;inset:auto 0 0 0;background:#000;color:#0f0;font:11px monospace;padding:6px;margin:0;white-space:pre-wrap';
    document.body.appendChild(el);
  }

  if (new URLSearchParams(location.search).has('selftest')) runSelfTest();
  else showScreen('start');
})();

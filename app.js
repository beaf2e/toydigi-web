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

  // 촬영 비율 — 아이폰 카메라처럼 세로 3:4 (가로:세로)
  const ASPECT = 3 / 4;

  // ----- 상태 -----
  const state = {
    facing: 'environment',
    stream: null,
    audioStream: null,
    preset: PRESETS.find(p => p.id === 'ccd') || PRESETS[0],
    mode: 'photo',
    zoom: 1,
    frame: 0,
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
      return true;
    } catch (err) { console.error(err); return false; }
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

  // ================= 프리셋 =================
  let kitKey = null, kit = null; // 캡처/녹화용 오버레이 캐시
  function applyPreset(p) {
    state.preset = p;
    if (hudPreset) {
      hudPreset.textContent = p.name;
      hudPreset.classList.remove('show'); void hudPreset.offsetWidth; hudPreset.classList.add('show');
    }
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
  function shutterSound() {
    if (!state.settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
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
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
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
    const vw = video.videoWidth, vh = video.videoHeight;
    let cw = vh * ASPECT, ch = vh;
    if (cw > vw) { cw = vw; ch = vw / ASPECT; }
    cw /= state.zoom; ch /= state.zoom;
    return { sx: (vw - cw) / 2, sy: (vh - ch) / 2, sw: cw, sh: ch, vw, vh };
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
    const p = state.preset; const lf = LOFI[state.settings.lofi];
    let outW = Math.min(1500, Math.round(crop.sw));
    outW = Math.round(outW * (1 - (p.lofi || 0) * 0.4) * lf.res);
    outW = Math.max(300, outW);
    const outH = Math.round(outW / ASPECT);

    const canvas = document.createElement('canvas'); canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    kitKey = null; // 캡처는 캡처 해상도 그레인으로 새로 생성
    drawFrame(ctx, outW, outH, p, {
      crop, mirror: state.facing === 'user' && state.settings.mirror,
      grainMul: lf.grain, frameIndex: 0, bloom: true,
    });
    kitKey = null; // 다음 녹화/프리뷰용으로 캐시 무효화

    if (p.border === 'polaroid') {
      const pad = Math.round(outW * 0.05), bottom = Math.round(outW * 0.18);
      const fc = document.createElement('canvas'); fc.width = outW + pad * 2; fc.height = outH + pad + bottom;
      const fx = fc.getContext('2d'); fx.fillStyle = '#f6f4ec'; fx.fillRect(0, 0, fc.width, fc.height);
      fx.drawImage(canvas, pad, pad); return fc;
    }
    return canvas;
  }

  async function takePhoto() {
    buzz([6, 4, 10]); shutterSound();
    flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 140);
    const canvas = capturePhoto(); if (!canvas) return;
    developing.classList.remove('hidden');
    state.frame++; frameCountEl.textContent = String(state.frame).padStart(3, '0');
    canvas.toBlob(async (blob) => {
      if (!blob) { developing.classList.add('hidden'); return; }
      try { await DB.add(blob, state.preset.name, 'photo'); setLastThumb(blob); } catch (e) {}
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
    const lf = LOFI[state.settings.lofi];
    const h = lf.vh, w = Math.round(h * ASPECT);
    recordCanvas.width = w; recordCanvas.height = h;
    const rctx = recordCanvas.getContext('2d');
    kitKey = null;
    let frame = 0;
    const loop = () => {
      if (!recording) return;
      const c = computeCrop();
      if (c.vw) drawFrame(rctx, w, h, state.preset, {
        crop: c, mirror: state.facing === 'user' && state.settings.mirror,
        grainMul: lf.grain, frameIndex: frame++, bloom: false,
      });
      rafId = requestAnimationFrame(loop);
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
    recBadge.classList.remove('hidden');
    recStart = performance.now();
    updateRecTime();
    recTimer = setInterval(updateRecTime, 500);
    loop();
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
    recBadge.classList.add('hidden');
    beep(440, 0.1); buzz([10, 30, 10]);
    try { recorder.stop(); } catch (e) {}
  }

  async function onRecStop() {
    const blob = new Blob(recChunks, { type: recMime });
    recChunks = [];
    if (!blob.size) return;
    state.frame++; frameCountEl.textContent = String(state.frame).padStart(3, '0');
    try { await DB.add(blob, state.preset.name, 'video'); setVideoThumb(blob); } catch (e) {}
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
  function revokeGalleryUrls() { galleryUrls.forEach(u => URL.revokeObjectURL(u)); galleryUrls = []; }
  async function openGallery() {
    revokeGalleryUrls();
    const grid = $('#galleryGrid'); grid.innerHTML = '';
    const items = await DB.all();
    $('#galleryEmpty').style.display = items.length ? 'none' : 'block';
    items.forEach(it => {
      const url = URL.createObjectURL(it.blob); galleryUrls.push(url);
      const cell = document.createElement('button'); cell.className = 'g-cell';
      cell.innerHTML = it.kind === 'video'
        ? `<video src="${url}" muted playsinline></video><span class="g-play">▶</span><span class="g-tag">${it.preset || ''}</span>`
        : `<img src="${url}" alt=""><span class="g-tag">${it.preset || ''}</span>`;
      cell.onclick = () => openViewer(it, url);
      grid.appendChild(cell);
    });
    showScreen('gallery');
  }

  let viewerCur = null;
  function openViewer(rec, url) {
    viewerCur = rec;
    const img = $('#viewerImg'), vid = $('#viewerVideo');
    if (rec.kind === 'video') {
      img.classList.add('hidden'); vid.classList.remove('hidden'); vid.src = url; vid.play().catch(() => {});
    } else {
      vid.classList.add('hidden'); vid.removeAttribute('src'); img.classList.remove('hidden'); img.src = url;
    }
    showScreen('viewer');
  }

  // ================= 설정 UI =================
  function syncSettingsUI() {
    $$('.sw').forEach(b => b.classList.toggle('on', !!state.settings[b.dataset.set]));
    $$('#lofiSeg button').forEach(b => b.classList.toggle('active', b.dataset.lofi === state.settings.lofi));
  }
  function openSettings() { syncSettingsUI(); $('#settings').classList.remove('hidden'); }
  function closeSettings() { $('#settings').classList.add('hidden'); }

  // ================= 화면 전환 =================
  function showScreen(name) {
    ['start', 'camera', 'result', 'gallery', 'viewer'].forEach(s => {
      $('#' + s).classList.toggle('hidden', s !== name);
    });
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
  $('#startBtn').onclick = async () => {
    $('#startHint').textContent = '카메라 켜는 중…';
    const ok = await startCamera();
    if (!ok) { $('#startHint').textContent = '카메라를 켤 수 없어요. 권한 또는 HTTPS를 확인하세요.'; return; }
    showScreen('camera');
    applyPreset(state.preset);
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

  $$('#zoomPills button').forEach(b => b.onclick = () => {
    state.zoom = parseFloat(b.dataset.z);
    $$('#zoomPills button').forEach(x => x.classList.toggle('active', x === b));
    video.style.transform = (state.facing === 'user' ? 'scaleX(-1) ' : '') + `scale(${state.zoom})`;
    buzz(6);
  });

  $$('#modeSeg .mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  $('#settingsBtn').onclick = openSettings;
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
  $('#galleryClose').onclick = () => { revokeGalleryUrls(); showScreen('camera'); };
  $('#clearAll').onclick = async () => { if (confirm('필름롤의 모든 사진/영상을 삭제할까요?')) { await DB.clear(); openGallery(); } };

  $('#retakeBtn').onclick = () => { const v = $('#resultVideo'); v.pause(); v.removeAttribute('src'); showScreen('camera'); };
  $('#saveBtn').onclick = () => state.lastBlob && saveBlob(state.lastBlob, fname(state.lastKind, state.lastBlob.type));

  $('#viewerClose').onclick = () => { $('#viewerVideo').pause(); openGallery(); };
  $('#viewerSave').onclick = () => viewerCur && saveBlob(viewerCur.blob, fname(viewerCur.kind, viewerCur.blob.type));
  $('#viewerDelete').onclick = async () => { if (viewerCur) { await DB.remove(viewerCur.id); openGallery(); } };

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
      showScreen('camera'); applyPreset(state.preset);
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
      if (c) { const px = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; log.push('px=' + px.join(',')); }
    } catch (e) { log.push('THROW:' + (e && e.message)); }
    document.title = 'SELFTEST ' + JSON.stringify(log);
    const el = document.createElement('pre'); el.id = 'selftest-result'; el.textContent = JSON.stringify(log, null, 1);
    el.style.cssText = 'position:fixed;z-index:99999;inset:auto 0 0 0;background:#000;color:#0f0;font:11px monospace;padding:6px;margin:0;white-space:pre-wrap';
    document.body.appendChild(el);
  }

  if (new URLSearchParams(location.search).has('selftest')) runSelfTest();
  else showScreen('start');
})();

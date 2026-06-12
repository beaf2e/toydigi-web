/* ToyDigi — 메인 앱 로직 (바닐라 JS) */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ----- 상태 -----
  const state = {
    facing: 'environment',
    stream: null,
    preset: PRESETS.find(p => p.id === 'ccd') || PRESETS[0],
    dateOn: true,
    soundOn: true,
    zoom: 1,
    frame: 0,
    lastBlobUrl: null,
  };

  // ----- 요소 -----
  const video = $('#video');
  const viewfinder = $('#viewfinder');
  const dateStamp = $('#dateStamp');
  const flash = $('#flash');
  const developing = $('#developing');
  const hudPreset = $('#hudPreset');
  const frameCountEl = $('#frameCount');

  // ================= 카메라 =================
  async function startCamera() {
    stopCamera();
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: state.facing },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
    };
    try {
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = state.stream;
      await video.play().catch(() => {});
      // 전면은 거울 모드
      video.style.transform = state.facing === 'user' ? 'scaleX(-1)' : 'none';
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
  }

  // ================= 프리셋 적용 =================
  function applyPreset(p) {
    state.preset = p;
    hudPreset.textContent = p.name;
    video.style.filter = p.css;
    video.style.transform =
      (state.facing === 'user' ? 'scaleX(-1) ' : '') + `scale(${state.zoom})`;

    const vf = viewfinder;
    vf.style.setProperty('--vignette', p.vignette);
    vf.style.setProperty('--grain-opacity', p.grain);
    vf.style.setProperty('--scanline-opacity', p.scanline);
    if (p.tint) {
      vf.style.setProperty('--tint-color', p.tint.color);
      vf.style.setProperty('--tint-alpha', p.tint.alpha);
      vf.style.setProperty('--tint-blend', p.tint.blend);
    } else {
      vf.style.setProperty('--tint-alpha', 0);
    }
    vf.classList.toggle('polaroid', p.border === 'polaroid');

    // 날짜 각인은 DATE 버튼이 단일 기준
    state.dateOn = $('#dateToggle').classList.contains('on');
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
      b.onclick = () => {
        applyPreset(p);
        b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        buzz(8);
      };
      bar.appendChild(b);
    });
    const active = bar.querySelector('.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  // ================= 날짜 각인 =================
  function two(n) { return String(n).padStart(2, '0'); }
  function updateDateStamp() {
    if (!state.dateOn) { dateStamp.style.display = 'none'; return; }
    const d = new Date();
    dateStamp.style.display = 'block';
    dateStamp.textContent = `${d.getFullYear()} ${two(d.getMonth() + 1)} ${two(d.getDate())}`;
  }

  // ================= 셔터음 + 진동 =================
  let audioCtx = null;
  function shutterSound() {
    if (!state.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      // 1) 짧은 "틱" (미러 올라가는 소리)
      const click = audioCtx.createOscillator();
      const cg = audioCtx.createGain();
      click.type = 'square'; click.frequency.value = 2400;
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      click.connect(cg).connect(audioCtx.destination);
      click.start(t); click.stop(t + 0.06);
      // 2) 노이즈 버스트 (셔터막)
      const dur = 0.08;
      const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const noise = audioCtx.createBufferSource(); noise.buffer = buf;
      const ng = audioCtx.createGain(); ng.gain.value = 0.18;
      const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
      noise.connect(hp).connect(ng).connect(audioCtx.destination);
      noise.start(t + 0.03);
    } catch (e) { /* 무음 폴백 */ }
  }
  function buzz(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

  // ================= 캡처 파이프라인 =================
  function makeGrainCanvas(w, h, amount) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ictx = c.getContext('2d');
    const img = ictx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 90;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255 * amount;
    }
    ictx.putImageData(img, 0, 0);
    return c;
  }

  function capture() {
    const p = state.preset;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    // 4:3 크롭 (뷰파인더와 동일 비율) + zoom 반영
    const targetRatio = 4 / 3;
    let cropW = vw, cropH = vw / targetRatio;
    if (cropH > vh) { cropH = vh; cropW = vh * targetRatio; }
    cropW /= state.zoom; cropH /= state.zoom;
    const sx = (vw - cropW) / 2, sy = (vh - cropH) / 2;

    // 출력 해상도 (lofi 일수록 작게 → 옛날 화질)
    let outW = Math.min(2000, Math.round(cropW));
    if (p.lofi) outW = Math.round(outW * (1 - p.lofi * 0.55));
    let outH = Math.round(outW / targetRatio);

    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');

    // 1) 색보정 + 프레임 그리기
    ctx.save();
    if ('filter' in ctx) ctx.filter = p.css;
    if (state.facing === 'user') { ctx.translate(outW, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, outW, outH);
    ctx.restore();

    // 2) 색감 틴트
    if (p.tint && p.tint.alpha > 0) {
      ctx.save();
      ctx.globalCompositeOperation = blendFor(p.tint.blend);
      ctx.globalAlpha = Math.min(1, p.tint.alpha * 2.2);
      ctx.fillStyle = p.tint.color;
      ctx.fillRect(0, 0, outW, outH);
      ctx.restore();
    }

    // 3) 블룸 (하이라이트 번짐)
    if (p.bloom > 0 && 'filter' in ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = p.bloom * 0.5;
      ctx.filter = 'brightness(1.6) blur(6px)';
      ctx.drawImage(canvas, 0, 0, outW, outH);
      ctx.restore();
    }

    // 4) 스캔라인
    if (p.scanline > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = p.scanline * 0.5;
      ctx.fillStyle = '#000';
      for (let y = 0; y < outH; y += 3) ctx.fillRect(0, y, outW, 1);
      ctx.restore();
    }

    // 5) 그레인
    if (p.grain > 0) {
      const g = makeGrainCanvas(Math.round(outW / 2), Math.round(outH / 2), p.grain);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(g, 0, 0, outW, outH);
      ctx.restore();
    }

    // 6) 비네팅
    if (p.vignette > 0) {
      const grad = ctx.createRadialGradient(
        outW / 2, outH / 2, Math.min(outW, outH) * 0.35,
        outW / 2, outH / 2, Math.max(outW, outH) * 0.72
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${p.vignette})`);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, outW, outH);
      ctx.restore();
    }

    // 7) 날짜 각인
    if (state.dateOn) {
      const d = new Date();
      const txt = `${d.getFullYear()} ${two(d.getMonth() + 1)} ${two(d.getDate())}`;
      const fs = Math.round(outW * 0.045);
      ctx.save();
      ctx.font = `${fs}px "VT323", monospace`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ff9a2e';
      ctx.shadowColor = 'rgba(255,120,0,0.9)';
      ctx.shadowBlur = fs * 0.5;
      ctx.fillText(txt, outW - fs * 0.6, outH - fs * 0.5);
      ctx.restore();
    }

    // 8) 폴라로이드 테두리
    let finalCanvas = canvas;
    if (p.border === 'polaroid') {
      const pad = Math.round(outW * 0.05);
      const bottom = Math.round(outW * 0.18);
      const fc = document.createElement('canvas');
      fc.width = outW + pad * 2; fc.height = outH + pad + bottom;
      const fctx = fc.getContext('2d');
      fctx.fillStyle = '#f6f4ec';
      fctx.fillRect(0, 0, fc.width, fc.height);
      fctx.drawImage(canvas, pad, pad);
      finalCanvas = fc;
    }

    return finalCanvas;
  }

  function blendFor(b) {
    const map = {
      'soft-light': 'soft-light', 'multiply': 'multiply',
      'screen': 'screen', 'overlay': 'overlay',
    };
    return map[b] || 'soft-light';
  }

  // ================= 촬영 흐름 =================
  async function takePhoto() {
    buzz([6, 4, 10]);
    shutterSound();
    // 플래시 깜빡임
    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 140);

    const canvas = capture();
    if (!canvas) return;

    // 현상 애니메이션
    developing.classList.remove('hidden');
    state.frame++;
    frameCountEl.textContent = String(state.frame).padStart(3, '0');

    canvas.toBlob(async (blob) => {
      if (!blob) { developing.classList.add('hidden'); return; }
      try {
        const rec = await DB.add(blob, state.preset.name);
        setLastThumb(blob);
      } catch (e) { console.warn('저장 실패', e); }

      if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
      state.lastBlobUrl = URL.createObjectURL(blob);
      state.lastBlob = blob;

      setTimeout(() => {
        developing.classList.add('hidden');
        $('#resultImg').src = state.lastBlobUrl;
        showScreen('result');
      }, 650);
    }, 'image/jpeg', 0.92);
  }

  function setLastThumb(blob) {
    const url = URL.createObjectURL(blob);
    const el = $('#lastThumb');
    el.innerHTML = `<img src="${url}" alt="">`;
  }

  // ================= 저장 / 공유 =================
  async function saveBlob(blob, name) {
    const file = new File([blob], name, { type: 'image/jpeg' });
    // 모바일: 네이티브 공유시트(사진 앱에 저장 가능)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'ToyDigi' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    // 데스크탑: 다운로드
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function fname() {
    const d = new Date();
    return `ToyDigi_${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.jpg`;
  }

  // ================= 갤러리 =================
  async function openGallery() {
    const grid = $('#galleryGrid');
    grid.innerHTML = '';
    const items = await DB.all();
    $('#galleryEmpty').style.display = items.length ? 'none' : 'block';
    items.forEach(it => {
      const url = URL.createObjectURL(it.blob);
      const cell = document.createElement('button');
      cell.className = 'g-cell';
      cell.innerHTML = `<img src="${url}" alt=""><span class="g-tag">${it.preset || ''}</span>`;
      cell.onclick = () => openViewer(it, url);
      grid.appendChild(cell);
    });
    showScreen('gallery');
  }

  let viewerCur = null;
  function openViewer(rec, url) {
    viewerCur = rec;
    $('#viewerImg').src = url;
    showScreen('viewer');
  }

  // ================= 화면 전환 =================
  function showScreen(name) {
    ['start', 'camera', 'result', 'gallery', 'viewer'].forEach(s => {
      $('#' + s).classList.toggle('hidden', s !== name);
    });
  }

  // ================= 이벤트 =================
  $('#startBtn').onclick = async () => {
    $('#startHint').textContent = '카메라 켜는 중…';
    const ok = await startCamera();
    if (!ok) {
      $('#startHint').textContent = '카메라를 켤 수 없어요. 권한을 확인하거나 HTTPS인지 확인하세요.';
      return;
    }
    showScreen('camera');
    applyPreset(state.preset);
    // 초당 날짜 갱신(자정 넘김 대비)
    setInterval(updateDateStamp, 30000);
  };

  $('#shutter').onclick = takePhoto;

  $('#flipBtn').onclick = async () => {
    state.facing = state.facing === 'environment' ? 'user' : 'environment';
    await startCamera();
    applyPreset(state.preset);
    buzz(10);
  };

  $('#zoom').oninput = (e) => {
    state.zoom = parseFloat(e.target.value);
    video.style.transform =
      (state.facing === 'user' ? 'scaleX(-1) ' : '') + `scale(${state.zoom})`;
  };

  $('#dateToggle').onclick = (e) => {
    e.currentTarget.classList.toggle('on');
    state.dateOn = e.currentTarget.classList.contains('on');
    updateDateStamp();
    buzz(8);
  };
  $('#dateToggle').classList.add('on');

  $('#soundToggle').onclick = (e) => {
    state.soundOn = !state.soundOn;
    e.target.classList.toggle('on', state.soundOn);
    buzz(8);
  };

  $('#galleryBtn').onclick = openGallery;
  $('#galleryClose').onclick = () => showScreen('camera');
  $('#clearAll').onclick = async () => {
    if (confirm('필름롤의 모든 사진을 삭제할까요?')) { await DB.clear(); openGallery(); }
  };

  $('#retakeBtn').onclick = () => showScreen('camera');
  $('#saveBtn').onclick = () => state.lastBlob && saveBlob(state.lastBlob, fname());

  $('#viewerClose').onclick = openGallery;
  $('#viewerSave').onclick = () => viewerCur && saveBlob(viewerCur.blob, fname());
  $('#viewerDelete').onclick = async () => {
    if (viewerCur) { await DB.remove(viewerCur.id); openGallery(); }
  };

  // 키보드(데스크탑 테스트): 스페이스=촬영, F=전환
  window.addEventListener('keydown', (e) => {
    if ($('#camera').classList.contains('hidden')) return;
    if (e.code === 'Space') { e.preventDefault(); takePhoto(); }
    if (e.key === 'f') $('#flipBtn').click();
  });

  // 탭 떠나면 카메라 정리 → 돌아오면 복구
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else if (!$('#camera').classList.contains('hidden') && !state.stream) startCamera();
  });

  // 서비스워커
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ================= 셀프테스트 (개발용: ?selftest) =================
  async function runSelfTest() {
    const log = [];
    window.addEventListener('error', (e) => log.push('ERR:' + e.message));
    try {
      // 헤드리스 가짜카메라가 불안정하므로 캔버스 합성 스트림으로 파이프라인만 검증
      const tc = document.createElement('canvas');
      tc.width = 640; tc.height = 480;
      const tx = tc.getContext('2d');
      const drawPattern = () => {
        const g = tx.createLinearGradient(0, 0, 640, 480);
        g.addColorStop(0, '#6db3ff'); g.addColorStop(0.5, '#ffd27f'); g.addColorStop(1, '#ff6f91');
        tx.fillStyle = g; tx.fillRect(0, 0, 640, 480);
        tx.fillStyle = '#fff'; tx.fillRect(60, 60, 180, 180);
        tx.fillStyle = '#111'; tx.fillRect(360, 240, 200, 160);
        tx.fillStyle = '#1f8a5b'; tx.beginPath(); tx.arc(480, 130, 70, 0, 7); tx.fill();
      };
      drawPattern();
      const stream = tc.captureStream(15);
      video.srcObject = stream;
      await video.play().catch(() => {});
      drawPattern();
      log.push('camera=synthetic');
      showScreen('camera');
      applyPreset(state.preset);
      for (let i = 0; i < 60 && !video.videoWidth; i++) await new Promise(r => setTimeout(r, 100));
      log.push('video=' + video.videoWidth + 'x' + video.videoHeight);
      let okCount = 0;
      for (const p of PRESETS) {
        applyPreset(p);
        const c = capture();
        if (c && c.width > 0) okCount++;
        else log.push('captureFail=' + p.id);
      }
      log.push('captures=' + okCount + '/' + PRESETS.length);
      const c = capture();
      if (c) {
        const px = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        log.push('centerPx=' + px[0] + ',' + px[1] + ',' + px[2] + ',' + px[3]);
      }
    } catch (e) { log.push('THROW:' + (e && e.message)); }
    document.title = 'SELFTEST ' + JSON.stringify(log);
    const el = document.createElement('pre');
    el.id = 'selftest-result';
    el.textContent = JSON.stringify(log, null, 1);
    el.style.cssText = 'position:fixed;z-index:99999;inset:auto 0 0 0;background:#000;color:#0f0;font:11px monospace;padding:6px;margin:0;white-space:pre-wrap';
    document.body.appendChild(el);
  }

  if (new URLSearchParams(location.search).has('selftest')) {
    runSelfTest();
  } else {
    showScreen('start');
  }
})();

/* ToyDigi 필터 프리셋
 * css      : <video> 와 capture(ctx.filter) 양쪽에 동일 적용되는 색보정
 * vignette : 0~1 가장자리 어둡게
 * grain    : 0~1 필름 그레인
 * scanline : 0~1 주사선(브라운관/VHS)
 * tint     : {color, alpha, blend} 색감 오버레이 (없으면 null)
 * bloom    : 0~1 하이라이트 번짐(플래시/현상)
 * halation : 0~1 하이라이트 둘레의 따뜻한 붉은 글로우 (필름 감성) ← digicam-filters 참고
 * chroma   : 0~1 색수차(RGB 채널 분리) ← 토이/렌즈 수차 느낌
 * leak     : 0~1 라이트릭(모서리 빛샘, 따뜻한 오렌지-레드) ← 일회용/만료 필름 느낌
 * lofi     : 0~1 해상도 낮춰 옛 똑딱이 화질
 * date     : 날짜각인 기본값(설정에서 최종 제어)
 * border   : null | 'polaroid'
 * desc     : 한 줄 설명
 */
const PRESETS = [
  {
    id: 'ccd', name: 'CCD', family: 'DIGI',
    css: 'contrast(1.12) saturate(1.18) brightness(1.03)',
    vignette: 0.28, grain: 0.10, scanline: 0, bloom: 0.18, halation: 0, chroma: 0.15, leak: 0, lofi: 0.25,
    tint: { color: '#0a2e3a', alpha: 0.06, blend: 'screen' }, date: true, border: null,
    desc: '2000년대 CCD 똑딱이 · 약간 시원한 색'
  },
  {
    id: 'ixus', name: 'IXUS', family: 'DIGI',
    css: 'contrast(1.08) saturate(1.12) brightness(1.05) sepia(0.08)',
    vignette: 0.22, grain: 0.08, scanline: 0, bloom: 0.22, halation: 0.25, chroma: 0, leak: 0, lofi: 0.25,
    tint: { color: '#ffae57', alpha: 0.07, blend: 'soft-light' }, date: true, border: null,
    desc: '캐논 IXUS 따뜻한 톤 · 은은한 글로우'
  },
  {
    id: 'night', name: 'NIGHT', family: 'DIGI',
    css: 'contrast(1.25) saturate(1.05) brightness(0.96)',
    vignette: 0.5, grain: 0.16, scanline: 0, bloom: 0.4, halation: 0.3, chroma: 0.2, leak: 0, lofi: 0.3,
    tint: { color: '#10204a', alpha: 0.12, blend: 'multiply' }, date: true, border: null,
    desc: '플래시 야간 · 깊은 비네팅과 번짐'
  },
  {
    id: 'toy', name: 'TOY', family: 'TOY',
    css: 'contrast(1.3) saturate(1.6) brightness(1.02) hue-rotate(-6deg)',
    vignette: 0.6, grain: 0.14, scanline: 0, bloom: 0.1, halation: 0, chroma: 0.15, leak: 0.2, lofi: 0.45,
    tint: { color: '#1d6e5a', alpha: 0.1, blend: 'soft-light' }, date: false, border: null,
    desc: '토이카메라 · 진한 채도와 강한 비네팅'
  },
  {
    id: 'lomo', name: 'LOMO', family: 'TOY',
    css: 'contrast(1.4) saturate(1.7) brightness(0.98)',
    vignette: 0.75, grain: 0.16, scanline: 0, bloom: 0.08, halation: 0, chroma: 0.25, leak: 0.3, lofi: 0.4,
    tint: { color: '#0b3b66', alpha: 0.14, blend: 'multiply' }, date: false, border: null,
    desc: '로모 · 극단적 비네팅 크로스프로세스'
  },
  {
    id: 'pink', name: 'PINK', family: 'TOY',
    css: 'contrast(1.12) saturate(1.35) brightness(1.07) hue-rotate(8deg)',
    vignette: 0.3, grain: 0.12, scanline: 0, bloom: 0.25, halation: 0.2, chroma: 0, leak: 0.4, lofi: 0.35,
    tint: { color: '#ff5fb0', alpha: 0.12, blend: 'soft-light' }, date: true, border: null,
    desc: 'Y2K 핑크 · 라이트릭'
  },
  {
    id: 'dream', name: 'DREAM', family: 'FILM',
    css: 'contrast(0.92) saturate(1.1) brightness(1.08) sepia(0.12)',
    vignette: 0.2, grain: 0.18, scanline: 0, bloom: 0.3, halation: 0.6, chroma: 0, leak: 0.15, lofi: 0.15,
    tint: { color: '#ffd9a8', alpha: 0.12, blend: 'soft-light' }, date: false, border: null,
    desc: '몽환 필름 · 강한 헐레이션 글로우'
  },
  {
    id: 'leak', name: 'LEAK', family: 'FILM',
    css: 'contrast(1.05) saturate(1.2) brightness(1.05) sepia(0.1)',
    vignette: 0.3, grain: 0.2, scanline: 0, bloom: 0.15, halation: 0.2, chroma: 0, leak: 0.8, lofi: 0.2,
    tint: { color: '#ffb066', alpha: 0.1, blend: 'soft-light' }, date: true, border: null,
    desc: '빛샘 가득 · 일회용 카메라 감성'
  },
  {
    id: 'gold', name: 'GOLD', family: 'FILM',
    css: 'contrast(1.06) saturate(1.15) brightness(1.04) sepia(0.18)',
    vignette: 0.25, grain: 0.22, scanline: 0, bloom: 0.12, halation: 0.35, chroma: 0, leak: 0, lofi: 0.15,
    tint: { color: '#ffb74d', alpha: 0.1, blend: 'soft-light' }, date: false, border: null,
    desc: '코닥 골드 · 따뜻한 필름'
  },
  {
    id: 'fuji', name: 'FUJI', family: 'FILM',
    css: 'contrast(1.1) saturate(1.1) brightness(1.02) hue-rotate(-10deg)',
    vignette: 0.24, grain: 0.2, scanline: 0, bloom: 0.1, halation: 0, chroma: 0, leak: 0, lofi: 0.15,
    tint: { color: '#1f8a5b', alpha: 0.08, blend: 'soft-light' }, date: false, border: null,
    desc: '후지 · 청록빛 필름'
  },
  {
    id: 'exp', name: 'EXP', family: 'FILM',
    css: 'contrast(0.95) saturate(0.9) brightness(1.06) sepia(0.12) hue-rotate(-12deg)',
    vignette: 0.35, grain: 0.28, scanline: 0, bloom: 0.14, halation: 0.2, chroma: 0, leak: 0.5, lofi: 0.2,
    tint: { color: '#c060a0', alpha: 0.12, blend: 'soft-light' }, date: false, border: null,
    desc: '유통기한 지난 필름 · 바랜 마젠타 빛샘'
  },
  {
    id: 'bw', name: 'B&W', family: 'FILM',
    css: 'grayscale(1) contrast(1.25) brightness(1.04)',
    vignette: 0.32, grain: 0.3, scanline: 0, bloom: 0.12, halation: 0, chroma: 0, leak: 0, lofi: 0.15,
    tint: null, date: false, border: null,
    desc: '흑백 필름 · 거친 그레인'
  },
  {
    id: 'vhs', name: 'VHS', family: 'TOY',
    css: 'contrast(1.15) saturate(1.3) brightness(1.02)',
    vignette: 0.3, grain: 0.12, scanline: 0.5, bloom: 0.16, halation: 0, chroma: 0.4, leak: 0, lofi: 0.5,
    tint: { color: '#2a5bd7', alpha: 0.1, blend: 'screen' }, date: true, border: null,
    desc: 'VHS · 주사선과 색수차'
  },
  {
    id: 'pola', name: 'POLA', family: 'FILM',
    css: 'contrast(1.0) saturate(1.05) brightness(1.08) sepia(0.1)',
    vignette: 0.2, grain: 0.16, scanline: 0, bloom: 0.18, halation: 0.2, chroma: 0, leak: 0, lofi: 0.2,
    tint: { color: '#eaf0d8', alpha: 0.12, blend: 'soft-light' }, date: false, border: 'polaroid',
    desc: '폴라로이드 · 흰 테두리'
  },
];

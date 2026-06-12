# ToyDigi 📷 (Web)

레트로 토이 + 빈티지 디카 필터 카메라 — **설치 없는 웹앱(PWA)**.
폰 브라우저에서 열어 홈화면에 추가하면 진짜 카메라 앱처럼 쓰입니다. 전부 무료, 광고/잠금 없음.

> 이전 네이티브(Swift) 시도(`~/Documents/ToyDigi`)의 감성을 웹으로 옮긴 버전.

## 디자인 — iOS 26 Liquid Glass
**iOS 26 Liquid Glass** 디자인 언어. 컨트롤이 콘텐츠(라이브 프리뷰) 위에 **떠 있는 반투명 글래스 레이어**로,
빛을 굴절·반사하고 탭하면 살짝 튕깁니다.
- 플로팅 글래스: 설정 버튼 · 줌 필(1×/2×/3×) · 필터 칩 · 모드 캡슐(슬라이딩 인디케이터) · 썸네일/플립 버튼
- 흰 셔터 링(영상=빨강 라운드), 세로 3:4 뷰파인더, SF 시스템 폰트, 스펙큘러 하이라이트
- 설정은 iOS 26 글래스 시트(그래버 · 반투명 그룹 · iOS 스위치 · 세그먼트)

## 기능
- **사진 + 영상 촬영** — PHOTO/VIDEO 모드 전환. 영상은 필터가 입혀진 화면을 그대로 녹화(canvas→MediaRecorder), 마이크 소리 옵션
- 실시간 뷰파인더 필터 (CSS filter + 블렌드 레이어, GPU 가속)
- 14개 프리셋: CCD · IXUS · NIGHT(디카) / TOY · LOMO · PINK · VHS(토이) / DREAM · LEAK · GOLD · FUJI · EXP · B&W · POLA(필름)
- 캡처/녹화 공용 후처리: 색감 틴트 · 블룸 · **헐레이션(따뜻한 글로우)** · **색수차** · **라이트릭(빛샘)** · 그레인 · 비네팅 · 스캔라인 · 날짜각인 · 폴라로이드 테두리
  (헐레이션·색수차·라이트릭은 오픈소스 [digicam-filters](https://github.com/Nora4844/digicam-filters)/디카 필터 기법에서 가져옴)
- **설정 시트(⚙)** — 날짜각인 · 셔터음 · 진동 · 셀카 좌우반전 · 영상 마이크 · **화질(선명/보통/빈티지/막구짐)** 토글, localStorage 저장
- **화질 LOFI** — 단계가 낮을수록 해상도↓·그레인↑·영상 비트레이트↓ 로 옛 디카처럼 구진 느낌(기본 빈티지)
- 셔터음(WebAudio 합성) · 진동 · 현상 애니메이션 · 전/후면 전환 · 디지털 줌
- 필름롤(IndexedDB, 사진·영상 모두) · 저장/공유(Web Share → iOS 사진앱 저장)
- 오프라인 동작(서비스워커), PWA 설치. 영상은 mp4(H.264) 우선, 미지원 시 webm

## 구조
```
index.html          화면 마크업 (시작/카메라/결과/갤러리/뷰어)
styles.css          레트로 토이 UI + 뷰파인더 오버레이
presets.js          ★ 필터 프리셋 정의 (여기만 고치면 새 필터 추가)
db.js               IndexedDB 필름롤 저장소
app.js              카메라·실시간필터·캡처·셔터음·갤러리 로직
manifest.webmanifest / sw.js / icons/   PWA
```

## 새 필터 추가
`presets.js`의 배열에 객체 하나 추가하면 끝. 각 필드 설명은 파일 상단 주석 참고.

## 로컬 실행 (이 맥에서 바로 테스트)
```bash
cd ~/Documents/toydigi-web
python3 -m http.server 8765
# 브라우저에서 http://localhost:8765 (localhost는 카메라 허용됨)
```
스페이스=촬영, F=전후면 전환. `?selftest` 붙이면 렌더링 자동검증 모드.

## 배포
폰에서 카메라를 쓰려면 **HTTPS**가 필요 → GitHub + Cloudflare Pages 권장(roomtone와 동일).
`git push` 후 Cloudflare Pages에서 저장소 연결하면 `*.pages.dev` 주소로 자동 배포됩니다.

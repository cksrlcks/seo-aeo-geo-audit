---
name: seo-aeo-geo-audit
description: Use when the user gives a website URL and wants its SEO, AEO(답변 엔진 최적화), GEO(생성형 엔진 최적화) or AI 검색 노출 readiness checked, scored, diagnosed, or delivered as a PDF report — including Lighthouse scores, AI 크롤러 · robots.txt 접근, llms.txt, 구조화 데이터, 즉답 문단, 출처 · 수치 · 갱신일 점검, 브랜드 언급(네이버 · 나무위키 · 위키백과), E-E-A-T, AI 플랫폼별 준비도(네이버 AI 브리핑 포함). Triggers include "SEO 점검", "AEO/GEO 분석", "AI 검색 최적화 진단", "사이트 리포트 뽑아줘", "라이트하우스 점수".
---

# SEO · AEO · GEO 점검 리포트

URL 하나를 받아 **측정 가능한 조건**만 자동 점검하고, 점수가 보이는 PDF 리포트를 만든다.
채점 기준과 근거는 `reference/checks.md` 에 고정되어 있다. 점검 중 기준을 새로 만들지 않는다.

## 절차

1. **URL 확보** — 사용자가 주지 않았으면 묻는다. 여러 개면 한 번에 하나씩 실행한다.
2. **의존성 확인** — `<skill-dir>/scripts/node_modules` 가 없으면 그 폴더에서 한 번만 실행:
   ```bash
   npm install --no-audit --no-fund
   ```
   Chrome(또는 Edge)이 설치되어 있어야 Lighthouse · 렌더링 비교 · PDF 가 동작한다.
3. **페이지 유형 판별** — 몇 초 만에 끝나는 판별만 먼저 실행한다.
   ```bash
   node "<skill-dir>/scripts/audit.mjs" <url> --detect
   ```
   출력 JSON 의 `confident` 가 true 면 `type`(home 또는 content)을 그대로 쓴다. false 면 AskUserQuestion 으로 묻는다: "이 URL 은 메인 · 소개 페이지인가요, 콘텐츠(글) 페이지인가요?" 선택지는 메인 · 소개(home) / 콘텐츠(글)(content) 두 개다. 로그인 · 앱 화면이라고 따로 묻지 않는다. 그런 화면은 측정된 그대로 채점한다.
   유형에 따라 두 섹션이 바뀐다. 콘텐츠는 즉답 문단 · 출처 수치 갱신일, 메인 · 소개는 핵심 소개 문단 · 운영 주체 신뢰 정보.
4. **실행** — 결과 파일은 사용자 프로젝트나 지정 폴더에 둔다(스크립트 폴더에 두지 않는다).
   ```bash
   node "<skill-dir>/scripts/audit.mjs" <url> --page-type <home|content> --out <결과 폴더>
   ```
   1 ~ 3분 걸린다. 끝나면 stdout 에 점수 요약, 우선 개선 과제, 파일 경로와 HTML · PDF 쪽수가 찍힌다.
   보고서는 표지 → 안내(보고서 취지, 글만 있는 한 쪽) → 한눈에 보기 → SECTION 01 ~ 07(측정 6개 + Lighthouse) → 08 문단 인용 가능성 · 09 브랜드 · AI 판단 평가(참고) → 개선 로드맵 → 부록 순서이고, HTML 과 PDF 는 쪽 구성이 같다. HTML 은 브라우저에서 A4 쪽 단위로 보이며 인쇄 버튼으로 PDF 를 다시 만들 수 있어 그대로 고객에게 보낼 수 있다. 디자인 규칙은 `reference/report-style-guide.md`. 사용자가 작성 기관을 밝혔으면 `--author` 로 표지와 바닥글에 넣는다.
5. **결과 확인** — stdout 에서 HTML 과 PDF 쪽수가 같고 1 이상이면 유효하다. 다르다는 경고가 찍히면 쪽 높이를 넘친 블록이 있는 것이니 HTML 을 열어 확인한다.
6. **Claude 판단 평가** — `reference/ai-review.md` 를 읽고 그 기준표대로 브랜드 언급(네이버 · 나무위키 · YouTube 는 점검 JSON 의 `brand.search` 화면 기록, 구글은 Claude in Chrome 등 실제 브라우저로 직접 연 검색 화면, 뉴스 · 커뮤니티 · LinkedIn 은 웹 검색), E-E-A-T, AI 플랫폼별 준비도(네이버 AI 브리핑 포함)를 판단해 결과 폴더에 `review.json` 을 쓴다. 근거는 점검 JSON 과 직접 연 페이지 · 검색 결과만 쓰고, 확인 못 한 것은 0점 + "확인 불가" 로 둔다. 그다음 보고서를 다시 만든다.
   ```bash
   node "<skill-dir>/scripts/render.mjs" <audit-….json> --review <review.json>
   ```
   형식 오류가 나면 출력된 위치를 고쳐 다시 실행한다. 점검 JSON 에도 `review` 가 합쳐져 저장된다. 끝에 HTML · PDF 쪽수가 찍히고, 다르면 경고와 함께 종료 코드 3 이다(5단계와 같이 확인).
7. **전달** — 아래 형식으로 답한다. 세부 근거를 물으면 JSON 의 `checks[]` (항목별 `detail` 에 측정값과 예시 문장이 있다)를 읽어 답한다.

| 옵션 | 뜻 |
|---|---|
| `--detect` | 페이지 유형만 판별해 JSON 으로 출력하고 끝낸다 |
| `--page-type home\|content` | 페이지 유형 지정. 없으면 자동 판별하고, 판별 실패 시 콘텐츠 기준 |
| `--out <dir>` | 결과 폴더 (기본: 현재 폴더) |
| `--author "<이름>"` | 표지의 작성자 · 작성 기관 (예: 에이전시명) |
| `--mobile` | Lighthouse 를 모바일 프리셋(CPU 4배 감속 · 느린 4G)으로. 기본은 데스크톱(CPU 1배) |
| `--skip-lighthouse` | Lighthouse 생략 (느리거나 실패할 때) |
| `--no-pdf` | JSON · HTML 만 생성 |

## 전달 형식

1. 첫 줄에 점검 URL · 점검 시각 · 페이지 유형(자동 판별 / 지정) · Lighthouse 기기(모바일/데스크톱).
2. 종합 · SEO · AEO · GEO 점수와 Lighthouse 4개 점수를 표로.
3. 측정 가능한 조건 6개의 점수 한 줄씩 (stdout 의 섹션 이름 그대로. 페이지 유형에 따라 즉답 문단 · 출처 수치 갱신일 또는 핵심 소개 문단 · 운영 주체 신뢰 정보).
4. 우선 개선 과제 (stdout 그대로, 최대 5개 · 적으면 있는 만큼). "해당 없음 · 참고" 항목은 생략하고 물으면 설명한다.
5. 참고 점수 한 줄씩 (종합 미포함이라고 밝힌다): 문단 인용 가능성, 브랜드 언급, E-E-A-T, AI 플랫폼 준비도(가장 낮은 플랫폼 이름 포함).
6. HTML · PDF 절대 경로와 쪽수. llms.txt 초안이 만들어졌으면 그 경로도.
7. 마지막 한 줄: "이 점검은 특정 질문에 인용된다는 보장, 고정된 AI 검색 순위, 모든 엔진에서 같은 결과, 경쟁사 대비 우위를 보장하지 않습니다."

## 하지 말 것

| 행동 | 이유 |
|---|---|
| 가중치 · 등급(A/B/C)을 즉석에서 만들어 다시 채점 | 점수가 실행마다 달라져 비교가 불가능해진다. 측정 점수의 기준은 `reference/checks.md`, 판단 평가의 기준은 `reference/ai-review.md` 하나다. |
| 참고 점수(문단 인용 · 브랜드 · E-E-A-T · 플랫폼)를 종합 점수에 합치기 | 근거가 약하거나 판단이 들어가 실행마다 흔들린다. 보고서에서도 따로 표기한다. |
| 검색 확인 없이 브랜드 언급 점수를 채우기 | 기억은 틀리거나 오래됐다. 실제로 연 검색 결과만 근거로 쓰고, 못 열었으면 "확인 불가" 0점. |
| FAQPage · HowTo · Speakable 스키마가 없다고 감점 | Google 은 AI 노출에 별도 스키마가 필요 없다고 명시했고, FAQ · HowTo 리치 결과는 축소되었다. |
| 학습용 봇(GPTBot · ClaudeBot) 차단을 감점 | 정책 선택이다. 검색 · 인용용 봇(OAI-SearchBot · PerplexityBot 등) 차단만 감점한다. |
| Lighthouse 점수를 종합 점수에 섞기 | 성능 점수는 측정마다 ±5 이상 흔들린다. 별도 표기만 한다. |
| "AI 에 인용됩니다" 같은 결과 보장 표현 | 측정 가능한 조건만 점검했다. 보장 불가 4개를 반드시 함께 쓴다. |
| 스크립트 대신 수동 curl · 임시 스크립트로 점수를 만들기 | 재현 불가. 판정이 의심스러우면 페이지를 열어 확인하고 "오탐 가능성"을 한 줄 덧붙이되, 점수는 그대로 둔다. 반복되는 오탐은 `audit.mjs` 의 정규식을 고치고 `reference/checks.md` 에 반영한다. |

## 문제 해결

- **Chrome 을 찾지 못함** → `CHROME_PATH` 환경변수에 chrome.exe 경로를 넣고 재실행.
- **Lighthouse 타임아웃 · 실패** → `--skip-lighthouse` 로 다시 실행. 리포트의 Core Web Vitals 항목은 "해당 없음"으로 남는다.
- **TLS 검증 실패(unable to verify the first certificate 등)** → 스크립트가 OS 인증서 저장소로 자동 재시도해 점검을 이어간다. 리포트의 "TLS 인증서 체인 검증" 항목이 실패로 남는데, 이는 서버가 중간 인증서를 빠뜨린 실제 결함이므로 핵심 과제로 전달한다. TLS 검증을 끄는 방식(NODE_TLS_REJECT_UNAUTHORIZED=0)은 쓰지 않는다.
- **HTTP 403 · 429** → 사이트가 봇을 막는 것이다. 리포트에 그대로 남기고 사용자에게 WAF · 보안 플러그인 허용 목록을 안내한다.
- **`brand.search` 의 네이버 · 나무위키 · YouTube 탭이 `ok: false`** → 스크립트의 Chrome 이 차단 화면을 받은 것이다. 웹 검색으로 대신 확인하고, 그래도 안 되면 해당 항목을 "확인 불가" 0점으로 둔다. WebFetch 로 네이버를 직접 열려고 하지 않는다(막혀 있다).
- **SSR 항목 실패** → SPA 다. 원본 HTML 에 본문이 없으면 대부분의 AI 크롤러가 읽지 못한다는 점을 핵심 과제로 전달한다.
- **구글 검색 칸을 확인할 수 없음** → 구글은 스크립트 Chrome(자동화 브라우저)을 확인 화면으로 막는다. Claude in Chrome 확장을 연결(`/chrome` → Enabled by default)하거나 데스크톱 앱 내장 브라우저로 판단 평가를 한다. 연결이 없으면 구글 칸은 "확인 불가" 0점. 자동화 흔적을 숨기는 우회는 쓰지 않는다.

# SEO · AEO · GEO 점검 보고서

URL 하나를 검색엔진(SEO), 답변 엔진(AEO), 생성형 엔진(GEO) 관점에서 점검하고, 점수가 보이는 보고서를 HTML 과 PDF 로 만드는 Claude Code 스킬입니다.

- 측정 가능한 조건만 봅니다. AI 크롤러 접근, 구조화 데이터, 즉답 · 소개 문단, 출처 · 신뢰 정보, 제목 · 메타 · 표준 URL, 기술 기본과 Lighthouse.
- 메인 · 소개 페이지와 콘텐츠(글) 페이지를 구분해 다른 기준으로 채점합니다. 판별이 애매하면 Claude 가 묻습니다.
- 보고서는 표지, 한눈에 보기, 섹션별 상세, 개선 로드맵, 부록 순서이고 HTML 과 PDF 의 쪽 구성이 같습니다. HTML 은 브라우저에서 A4 쪽으로 보이며 인쇄 버튼으로 PDF 를 다시 만들 수 있습니다.

## 필요한 것

- Claude Code
- Node.js 22.19 이상 (Lighthouse 13 요구 사항)
- Chrome 또는 Edge (Lighthouse, 렌더링 비교, PDF 생성에 씁니다)

## 설치

둘 중 하나를 고릅니다. 업데이트를 받기 편한 것은 플러그인 방식입니다.

**Claude Code 플러그인** — Claude Code 안에서 입력합니다.

```
/plugin marketplace add cksrlcks/seo-aeo-geo-audit
/plugin install seo-aeo-geo-audit@uxis-tools
```

**skills CLI** — 터미널에서 입력합니다. `-g` 는 모든 프로젝트에서 쓰도록 사용자 폴더에 설치합니다.

```bash
npx skills add cksrlcks/seo-aeo-geo-audit -g -a claude-code
```

첫 실행 때 스킬이 `scripts` 폴더에서 `npm install` 을 한 번 실행합니다(1분 안팎).

## 사용

Claude Code 에서 이렇게 요청합니다.

```
https://example.com SEO · AEO · GEO 점검해서 보고서 만들어줘
```

직접 부르려면 플러그인은 `/seo-aeo-geo-audit:seo-aeo-geo-audit`, skills CLI 설치는 `/seo-aeo-geo-audit` 입니다.

결과는 `audit-<도메인>-<날짜시각>` 이름의 `.html` · `.pdf` · `.json` 세 파일입니다. Claude 가 점수 요약, 우선 개선 과제, 파일 경로를 알려 줍니다.

## 업데이트

| 설치 방식 | 명령 |
|---|---|
| 플러그인 | `/plugin marketplace update uxis-tools` 다음 `/plugin update seo-aeo-geo-audit@uxis-tools` |
| skills CLI | `npx skills update` |

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `.claude-plugin/` | 플러그인 설정(`plugin.json`, 버전은 여기 한 곳)과 마켓플레이스 설정(`marketplace.json`) |
| `skills/seo-aeo-geo-audit/SKILL.md` | Claude 가 따르는 절차 · 전달 형식 · 하지 말 것 |
| `skills/seo-aeo-geo-audit/reference/checks.md` | 점검 항목, 가중치, 통과 기준, 근거 |
| `skills/seo-aeo-geo-audit/reference/report-style-guide.md` | 보고서 디자인 규칙(색 · 글자 · 간격 · 컴포넌트 · 쪽) |
| `skills/seo-aeo-geo-audit/scripts/audit.mjs` | 수집 · 채점 · 파일 출력 |
| `skills/seo-aeo-geo-audit/scripts/report.mjs` | 보고서 구조 · 문구와 A4 쪽 나누기 |
| `skills/seo-aeo-geo-audit/scripts/report.css` | 보고서 스타일(스타일 가이드 구현) |
| `skills/seo-aeo-geo-audit/scripts/render.mjs` | 저장된 점검 JSON 으로 보고서 HTML · PDF 만 다시 그리기(양식 수정용) |

## 보고서 양식 · 채점 기준을 고칠 때

1. 고칠 곳을 고릅니다.
   - 색 · 글자 · 간격 · 컴포넌트 모양은 `report-style-guide.md` 를 먼저 고치고 `report.css` 에 반영합니다. CSS 는 가이드의 토큰만 씁니다.
   - 장 구성 · 문구는 `report.mjs` 입니다.
   - 점검 항목 · 가중치 · 기준은 `audit.mjs` 와 `checks.md` 를 함께 고칩니다.
2. 저장소 밖 폴더로 결과를 내며 확인합니다.
   ```bash
   cd skills/seo-aeo-geo-audit/scripts
   npm install
   node audit.mjs https://example.com --out ~/audit-test
   ```
   출력 끝에 HTML 과 PDF 쪽수가 같게 나오면 쪽 나누기가 정상입니다. `--skip-lighthouse --no-pdf` 를 붙이면 빠르게 볼 수 있습니다.
   양식만 고칠 때는 점검을 다시 돌리지 않고 이미 만든 JSON 으로 다시 그립니다(몇 초).
   ```bash
   node render.mjs ~/audit-test/audit-example.com-....json ~/audit-test/preview
   ```
3. `.claude-plugin/plugin.json` 의 `version` 을 올립니다. 보고서 바닥글의 버전 표기도 여기서 읽습니다.
4. `claude plugin validate .` 로 확인한 뒤 커밋 · 푸시합니다.
5. 팀원은 위 업데이트 명령으로 받습니다.

저장소를 클론한 뒤 `skills/seo-aeo-geo-audit` 폴더를 `~/.claude/skills/` 에 링크해 두면, 고친 내용을 플러그인 배포 없이 바로 시험할 수 있습니다.

## 이 점검이 보장하지 않는 것

특정 질문에 반드시 인용된다는 보장, 고정된 “AI 검색 순위”, 모든 엔진에서 같은 결과, 경쟁사 대비 우위. 공개된 HTML · HTTP 응답 · robots.txt · 사이트맵 · llms.txt 와 Lighthouse 랩 측정으로 확인할 수 있는 조건만 점검합니다.

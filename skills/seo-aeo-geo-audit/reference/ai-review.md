# Claude 판단 평가 기준 (참고 점수)

`audit.mjs` 가 끝난 뒤 Claude 가 이 기준표로 판단해 `review.json` 을 쓰고, `render.mjs --review` 로 보고서에 합친다.
세 점수 모두 **참고 점수**다. 종합 · SEO · AEO · GEO 점수에 섞지 않는다. 배점과 기준은 이 문서에 고정한다. 평가 중 기준을 새로 만들지 않는다.

출처: [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) 의 geo-brand-mentions · geo-content · geo-platform-optimizer 를 한국 검색 환경에 맞게 고쳤다. 배점은 설계 기준이며 통제된 연구에서 나온 값이 아니다.

## 공통 규칙

- 근거는 점검 JSON(`checks[]`, `facts`, `brand`, `citability`)과 직접 연 페이지 · 검색 결과만 쓴다. 기억이나 추측으로 채우지 않는다.
- **평가 전에 운영 주체부터 확인한다.** 사이트 하단 사업자 정보 · 문의 페이지 · 개인정보처리방침에서 상호를 찾는다. 브랜드 소유자와 사이트 운영자가 다를 수 있다(예: 호텔 브랜드 사이트를 분양 시행사가 운영). E-E-A-T `권위` 의 `evidence` 첫 문장에 적는다. 예: "사이트 운영: ○○㈜(분양 시행사), 브랜드: ○○ 그룹".
- **같은 실체로 확정한 결과만 센다.** 사이트 주소 · 업종 · 지역 · 대표자 · 운영 주체로 확인한다. 하나라도 어긋나 확정하지 못하면 세지 않고, `found` 에 "같은 실체 확인 안 됨: 이유" 를 적는다. 예: 기사 속 대표 이름이 사업자 정보의 대표와 다름.
- **정보 패널 · 지식백과 · 위키 문서가 다른 실체면 0점이다.** 헤딩(`기본정보` 등)만 보고 세지 않는다. 혼동 위험은 해당 AI 플랫폼(네이버 AI 브리핑 등)의 `gaps` 에 적는다.
- **영업 · 광고 · 채용 글은 제3자 언급으로 세지 않는다.** 네이버 블로그 · 카페, 커뮤니티, YouTube 영상 모두 같다. 분양 · 회원권 영업, 체험단 · 협찬 표시, 구인 글이 여기에 든다.
- **같은 기사는 두 칸에서 모두 센다.** "네이버 뉴스" 는 네이버 뉴스 탭에 노출되는지만 보고, "뉴스 · 업계 매체" 는 매체 기사 건수를 본다.
- **건수 단계**: 건수로 매기는 칸은 아래 표에 적힌 단계만 쓴다. 중간 점수를 만들지 않는다.
- **`found` 문구는 두 가지를 구분한다.**
  - 찾아봤지만 없음: "검색 결과 없음 (<검색어>, <확인 수단>)"
  - 도구 한계로 못 봄: "확인 불가: <이유>" (차단 화면 · 로그인 · 결과가 잘림 · 확인 수단 없음)
  - 둘 다 0점이다. 있다고 가정하지 않는다.
- 문구는 보고서에 그대로 실리므로 고객이 읽을 한국어 문장으로 쓴다. 과장 · 결과 보장 표현 금지.

## 1. 브랜드 언급 (100점 환산)

브랜드명은 점검 JSON 의 `brand.name`.

**네이버 · 나무위키 · YouTube 는 직접 열지 않고 점검 JSON 의 `brand.search` 를 근거로 쓴다.** 스크립트가 Chrome 으로 연 화면 기록이다(한국어 · 서울 시간대 · 일반 데스크톱 UA).
- `brand.search.naver` 의 `total` · `news`(최신순) · `blog` · `cafe` 탭마다:
  - `officialRank`: 포털 도메인을 뺀 외부 도메인 중 공식 사이트 순서
  - `headings`: 영역 제목
  - `items`: 브랜드 키워드 `brand.search.keys` 가 제목에 든 결과 링크 · 문맥, 최대 15
  - `text`: 화면 텍스트 앞부분(통합검색 8,000자, 나머지 3,000자)
- `items` 에는 동명 회사 결과가 섞인다. 공통 규칙대로 같은 실체인 것만 센다.
- `brand.search.namu`
  - `found`: true 문서 있음, false 404.
  - `doc`: 실제로 연 문서명(넘겨주기 반영).
  - 브랜드명 그대로 열어 404 이고 네이버 통합검색에 나무위키 링크가 있으면, 스크립트가 그 문서로 다시 연다. 이때 `tried` 에 처음 연 주소, `via` 에 "네이버 통합검색 링크" 가 남는다.
  - 그래도 없으면 웹 검색으로 다른 문서명을 한 번 찾아본다.
- `brand.search.youtube`: YouTube 검색 결과 화면.
  - `channels`: 채널 결과(`name` · `href` · `meta` 구독자 수), 최대 5
  - `videos`: 영상 결과(`title` · `href` · `channel` · `channelHref` · `context` 카드 문구: 조회수 · 올린 시점 · 설명 앞부분), 최대 15
  - YouTube 화면 구성은 실행마다 바뀐다. `videos` · `channels` 가 비었는데 `text` 에 영상 제목 · 채널명이 보이면 `text` 로 판단한다.
- 탭이 `ok: false`(차단 화면 · 오류)일 때만 웹 검색으로 대신 확인한다. 그래도 안 되면 0점 + "확인 불가".

**구글은 스크립트가 열 수 없다**(자동화 브라우저를 구글이 확인 화면 · HTTP 429 로 막는다). 판단 평가 때 Claude 가 **사람이 쓰는 실제 브라우저**로 직접 연다.
- 도구: Claude in Chrome(`mcp__claude-in-chrome__*`) 또는 Claude 데스크톱 앱 내장 브라우저. 둘 다 없으면 구글 칸은 0점 + "확인 불가: 실제 브라우저 연결 없음". 웹 검색 · 스크립트 Chrome 으로 대신하지 않는다(순위 · 패널이 다르게 나온다).
- 주소: `https://www.google.com/search?q=<brand.name>&hl=ko&gl=kr` 한 번만 연다. 새 탭을 만들어 열고, 다 보면 닫는다.
- "비정상적인 트래픽" · 로그인 확인 화면이 뜨면 사용자에게 풀어 달라고 요청한다. 풀지 못하면 0점 + "확인 불가: 구글 확인 화면".
- 화면에서 읽을 것: 검색 결과 제목 · 주소 순서(광고 제외), 공식 결과 아래 사이트 하위 링크, 오른쪽 패널(비즈니스 프로필 · 지식 패널: 이름 · 주소 · 전화 · "이 비즈니스의 소유주인가요?" 문구 · 리뷰 수), AI 개요 표시 여부.
- `found` 끝에 "(로그인 상태)" 또는 "(로그아웃 상태)" 를 적는다. 로그인 상태는 검색 기록에 따른 개인화가 섞일 수 있다.

| platform | weight | 세부 배점 | 확인 방법 |
|---|---|---|---|
| 네이버 | 25 | 공식 사이트 노출 10: `total.officialRank` 1 ~ 3 → 10, 4 ~ 10 → 5, 그 밖 0<br>정보 영역 5: 같은 실체의 지식백과 · 인물정보 · 기업 정보 · 플레이스 패널 있음 5, 없거나 다른 실체 0<br>뉴스 5: `news.items` 중 같은 실체 · 최근 2년 기사 0건 0 / 1 ~ 2건 2 / 3건 이상 5<br>블로그 · 카페 5: 공식 블로그 · 영업 · 광고 · 채용 글을 뺀 제3자 글 0건 0 / 1 ~ 2건 2 / 3건 이상 5 | `brand.search.naver` (`total.headings` · `text`, `news` · `blog` · `cafe` 의 `items`) |
| 구글 | 25 | 공식 사이트 노출 10: 광고를 뺀 검색 결과 중 공식 사이트 1 ~ 3위 → 10, 4 ~ 10위 → 5, 그 밖 0<br>사이트 하위 링크 5: 공식 결과 아래 하위 페이지 링크(사이트링크) 묶음 있음 5, 없음 0<br>비즈니스 프로필 · 지식 패널 5: 같은 실체 패널이 있고 "이 비즈니스의 소유주인가요?" 문구가 없음(소유권 등록) 5 / 패널은 있으나 그 문구가 보임(미등록) 2 / 없거나 다른 실체 0<br>Google 리뷰 5: 같은 실체 패널의 리뷰 0개 0 / 1 ~ 9개 2 / 10개 이상 5 | 실제 브라우저로 연 구글 검색 화면(위 절차) |
| 위키 | 20 | 나무위키 8, 위키백과(ko 또는 en) 8, Wikidata 4. 같은 실체 문서만 | `brand.search.namu`, `brand.wikipedia`, `brand.wikidata` |
| YouTube | 15 | 공식 채널 7: 같은 실체의 공식 채널 있음 7, 없음 0<br>제3자 영상 8: 공식 채널 · 영업 · 광고 영상을 뺀 같은 실체 영상 0건 0 / 1 ~ 2건 4 / 3건 이상 8 | `brand.search.youtube` (`channels`, `videos` 의 `channel`), `brand.channels` |
| 뉴스 · 업계 매체 | 10 | 최근 2년 안의 같은 실체 기사 0건 0 / 1 ~ 2건 5 / 3건 이상 10 | 웹 검색, `brand.search.naver.news` |
| 커뮤니티 | 10 | Reddit · 국내 커뮤니티 · 지식iN 의 제3자 질문 · 추천 글(영업 · 광고 글 제외) 0건 0 / 1 ~ 2건 5 / 3건 이상 10 | 웹 검색 `site:reddit.com <브랜드>`, `brand.search.naver.cafe` 의 이용자 글 |
| LinkedIn | 10 | 회사 페이지 5: 있음 5, 없음 0<br>활동 5: 최근 1년 게시물 보임 5 / 게시물은 없지만 팔로워 · 직원 연결 표시 2 / 그 밖 0 | 웹 검색 `site:linkedin.com/company <브랜드>` |

`brand.items` 는 위 7개를 이 순서 · 이 `platform` 이름 · 이 `weight` 로 모두 쓴다. `score` 는 세부 배점의 합(0 ~ weight). `found` 에 세부 배점별 근거를 짧게 쓴다. 예: "공식 사이트 1위(10), 정보 영역 없음(0), 뉴스 3건(5), 제3자 블로그 1건(2)". 배점 합 115 를 보고서가 100점으로 환산한다(1.7.0 부터. 그 전 보고서는 구글 칸 없이 90 기준이라 점수를 그대로 비교하지 않는다). 다음(Daum) 검색은 확인하지 않는다.

## 2. E-E-A-T (4 × 25 = 100점)

페이지 하나가 아니라 점검 페이지와 거기서 바로 이어지는 회사 소개 · 저자 소개 페이지까지 본다.

| name | 25점 | 15점 안팎 | 5점 이하 |
|---|---|---|---|
| 경험 | 자체 데이터 · 사례(수치 결과) · 직접 해 본 과정이 구체적 | 사례는 있으나 수치 · 과정이 빈약 | 누구나 쓸 수 있는 일반론 |
| 전문성 | 이름 있는 저자 · 담당자 + 경력 · 자격 + 소개 페이지, 내용의 기술적 깊이 | 저자 또는 회사 전문 분야는 보이나 근거 약함 | 저자 · 전문성 표시 없음 |
| 권위 | 회사 소개 충실, 외부 인용 · 수상 · 언론 보도, sameAs 로 공식 채널 연결 | 회사 소개만 있음 | 운영 주체 정보 빈약 |
| 신뢰 | HTTPS, 연락처 · 주소 · 사업자 정보, 개인정보처리방침, 출처 표기, 게시 · 갱신일 | 일부 빠짐 | 대부분 빠짐 |

`evidence` 에 판단 근거(페이지에서 본 것)를, `fix` 에 가장 효과가 큰 개선 한 가지를 쓴다. `권위` 의 `evidence` 는 운영 주체로 시작한다(공통 규칙).

## 3. AI 플랫폼별 준비도 (각 100점, 평균)

각 플랫폼 점수 = 접근(40) + 내용 구조(30) + 출처 · 엔티티 신호(30).

**접근 40** (점검 JSON): 해당 봇이 모두 허용이고 SSR 통과면 40, 하나라도 차단 · SSR 실패면 0, 그 밖(SSR 주의 등)은 20.

**내용 구조 30 · 출처 · 엔티티 30** 은 아래 하위 항목의 합이다.
- `checks[]` id 가 적힌 항목은 그 상태로 매긴다: 통과(pass) 만점, 주의(warn) 절반(소수점 버림), 실패(fail) · 해당 없음(na) 0.
- id 가 `콘텐츠 / 메인` 으로 둘이면 점검 JSON 의 `pageType` 이 content 일 때 앞, home 일 때 뒤를 쓴다.
- id 가 없는 항목만 판단하며, 적힌 단계만 쓴다.

| name | 접근 40 (점검 JSON) | 내용 구조 30 | 출처 · 엔티티 30 |
|---|---|---|---|
| Google AI 오버뷰 | Googlebot 허용 · noindex 없음 · SSR | 소제목 10 `question-headings / section-headings`<br>즉답 10 `direct-answer / intro-sentence`<br>목록 · 본문 텍스트 10 `lists-tables / service-text` | 페이지 유형 스키마 10 `ld-content-type`<br>엔티티 · sameAs 10 `ld-entity`<br>저자 · 날짜 10: 콘텐츠는 `author` · `dates` 둘 다 통과 10, 하나 5, 없음 0 / 메인은 `org-details` |
| ChatGPT 검색 | OAI-SearchBot · ChatGPT-User 허용, bot-probe 정상 | 출처 붙은 수치 10 `sourced-stats / intro-sentence`<br>외부 출처 링크 10 `outbound-sources / service-text`<br>즉답 10 `direct-answer / intro-snippet` | 위키백과 10: `brand.wikipedia` ko 또는 en 같은 실체 문서 있음 10, 없음 0<br>Wikidata 10: `brand.wikidata` 같은 실체 있음 10, 없음 0<br>sameAs 10 `ld-entity` |
| Perplexity | PerplexityBot · Perplexity-User 허용 | 즉답 10 `direct-answer / intro-sentence`<br>수치 10: 콘텐츠는 `sourced-stats` / 메인은 본문에 수치(연도 · 규모 · 가격 등) 문장 3개 이상 10, 1 ~ 2개 5, 없음 0<br>목록 · 소제목 10 `lists-tables / section-headings` | 커뮤니티 언급 15: 브랜드 언급 `커뮤니티` 점수 10 → 15, 5 → 8, 0 → 0<br>최신 갱신 15 `freshness / site-freshness` (주의 7) |
| Gemini | Googlebot 허용(Google-Extended 차단은 감점 없음) | Google AI 오버뷰의 내용 구조 점수를 그대로 쓴다 | Organization · sameAs 10 `ld-entity`<br>YouTube 10: 공식 채널 있음 5 + 제3자 영상 1건 이상 5 (브랜드 언급 YouTube 칸과 같은 근거)<br>Google 비즈니스 프로필 10: 브랜드 언급 구글 칸에서 같은 실체 비즈니스 프로필 패널이 보이면 10, 아니면 0(실제 브라우저가 없으면 확인 불가 0) |
| Copilot | Bingbot 허용 | 제목 · 메타 10: `title` · `meta-description` 둘 다 통과 10, 하나 5, 없음 0<br>소제목 10 `question-headings / section-headings`<br>즉답 10 `direct-answer / intro-snippet` | LinkedIn 회사 페이지 10: 브랜드 언급 LinkedIn 의 페이지 5점이면 10, 아니면 0<br>사이트맵 10 `sitemap`<br>sameAs 10 `ld-entity` |
| 네이버 AI 브리핑 | `facts.koBots` 의 Yeti 가 robots.txt 허용 · 실제 요청(`probe`) 2xx · 3xx, SSR | 소제목 10 `question-headings / section-headings`<br>즉답 10 `direct-answer / intro-sentence`<br>네이버 원문 10: `brand.search.naver` 블로그 · 카페에서 같은 실체 제3자 글(영업 · 광고 제외) 3건 이상 10, 1 ~ 2건 5, 없음 0 | 네이버 검색 노출 10: `total.officialRank` 1 ~ 3 → 10, 4 ~ 10 → 5, 그 밖 0<br>정보 영역 10: 브랜드 언급 네이버의 정보 영역 5점이면 10, 아니면 0<br>네이버 공식 채널 10: 같은 실체의 네이버 블로그 · 플레이스 · 스마트스토어 등 2개 이상 10, 1개 5, 없음 0 (`brand.channels`, `brand.search.naver`) |

6개 플랫폼을 이 순서 · 이 `name` 으로 모두 쓴다.
`strengths` 에 강점, `gaps` 에 부족한 점을 한두 문장씩 쓴다. 다른 실체와 혼동될 위험(동명 회사 정보 패널, 비슷한 이름의 영업 도메인)이 있으면 `gaps` 에 적는다.

## review.json 형식

```json
{
  "brand": {
    "items": [
      { "platform": "네이버", "weight": 25, "score": 17, "found": "공식 사이트 1위(10), 정보 영역 없음(0), 뉴스 3건(5), 제3자 블로그 1건(2)", "url": "https://search.naver.com/search.naver?query=..." }
    ]
  },
  "eeat": [
    { "name": "경험", "score": 12, "evidence": "…", "fix": "…" },
    { "name": "전문성", "score": 10, "evidence": "…", "fix": "…" },
    { "name": "권위", "score": 14, "evidence": "사이트 운영: …. …", "fix": "…" },
    { "name": "신뢰", "score": 20, "evidence": "…", "fix": "…" }
  ],
  "platforms": [
    { "name": "Google AI 오버뷰", "score": 72, "strengths": "…", "gaps": "…" }
  ]
}
```

| 위치 | 필드 | 필수 | 규칙 |
|---|---|---|---|
| `brand.items[]` | `platform` | 필수 | 7개, 순서 · 이름 고정: "네이버", "구글", "위키", "YouTube", "뉴스 · 업계 매체", "커뮤니티", "LinkedIn" |
| | `weight` | 필수 | 25 · 25 · 20 · 15 · 10 · 10 · 10 고정 |
| | `score` | 필수 | 0 ~ weight |
| | `found` | 필수 | 빈 문자열 금지 |
| | `url` | 선택 | 대표 근거 주소. 있으면 보고서에 작게 표시 |
| `eeat[]` | `name` | 필수 | 4개, 순서 고정: 경험 · 전문성 · 권위 · 신뢰 |
| | `score` | 필수 | 0 ~ 25 |
| | `evidence` · `fix` | 필수 | 빈 문자열 금지 |
| `platforms[]` | `name` | 필수 | 6개, 순서 · 이름 고정: Google AI 오버뷰 · ChatGPT 검색 · Perplexity · Gemini · Copilot · 네이버 AI 브리핑 |
| | `score` | 필수 | 0 ~ 100 |
| | `strengths` · `gaps` | 필수 | 빈 문자열 금지 |

`render.mjs` 가 이 표대로 검사하고, 틀리면 보고서를 만들지 않고 오류 위치를 출력한다. 항목 이름 · 순서 · weight 는 `scripts/report.mjs` 의 `REVIEW_BRAND` · `REVIEW_EEAT` · `REVIEW_PLATFORMS` 와 같아야 한다(이 표를 바꾸면 같이 고친다). 보고서를 만든 뒤 HTML · PDF 쪽수를 세어 함께 출력하며, 다르면 경고하고 종료 코드 3 으로 끝난다.

# Claude 판단 평가 기준 (참고 점수)

`audit.mjs` 가 끝난 뒤 Claude 가 이 기준표로 판단해 `review.json` 을 쓰고, `render.mjs --review` 로 보고서에 합친다.
세 점수 모두 **참고 점수**다. 종합 · SEO · AEO · GEO 점수에 섞지 않는다. 배점과 기준은 이 문서에 고정한다. 평가 중 기준을 새로 만들지 않는다.

출처: [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) 의 geo-brand-mentions · geo-content · geo-platform-optimizer 를 한국 검색 환경에 맞게 고쳤다. 배점은 설계 기준이며 통제된 연구에서 나온 값이 아니다.

## 공통 규칙

- 근거는 점검 JSON(`checks[]`, `facts`, `brand`, `citability`)과 직접 연 페이지 · 검색 결과만 쓴다. 기억이나 추측으로 채우지 않는다.
- 확인하지 못한 항목(차단 · 로그인 · 검색 실패)은 0점으로 두고 `found` 에 "확인 불가: 이유" 를 적는다. 있다고 가정하지 않는다.
- 문구는 보고서에 그대로 실리므로 고객이 읽을 한국어 문장으로 쓴다. 과장 · 결과 보장 표현 금지.

## 1. 브랜드 언급 (100점 환산)

브랜드명은 점검 JSON 의 `brand.name`. 동명 브랜드와 헷갈리지 않게 사이트 주소 · 업종으로 같은 실체인지 확인한다.

**네이버 · 나무위키는 직접 열지 않고 점검 JSON 의 `brand.search` 를 근거로 쓴다.** 스크립트가 Chrome 으로 연 화면 기록이다(한국어 · 서울 시간대 · 일반 데스크톱 UA).
- `brand.search.naver` 의 `total` · `news`(최신순) · `blog` · `cafe` 탭마다: `officialRank`(포털 도메인을 뺀 외부 도메인 중 공식 사이트 순서), `headings`(영역 제목), `items`(브랜드 키워드 `brand.search.keys` 가 제목에 든 결과 링크 · 문맥, 최대 15), `text`(화면 텍스트 앞 3,000자).
- `items` 에는 동명 회사 결과가 섞인다. 문맥과 주소로 같은 실체인 것만 센다.
- `brand.search.namu.found`: true 문서 있음, false 404. 문서명이 다를 수 있으니 없으면 웹 검색으로 다른 문서명을 한 번 찾아본다.
- 탭이 `ok: false`(차단 화면 · 오류)일 때만 웹 검색으로 대신 확인하고, 그래도 안 되면 0점 + "확인 불가".

| platform | weight | 만점 조건 | 확인 방법 |
|---|---|---|---|
| 네이버 | 25 | 브랜드 검색 시 공식 사이트가 상위 노출 + 지식백과 · 인물정보 · 플레이스 등 정보 영역 + 뉴스 · 블로그 · 카페에 제3자 언급 다수 | `brand.search.naver`. 공식 사이트 노출 10(`total.officialRank` 1 ~ 3: 10, 4 ~ 10: 5), 정보 영역 5(`total.headings` · `text`), 뉴스 5(`news.items` 중 같은 실체, 최근 2년), 블로그 · 카페 5(공식 블로그 외 제3자 글) |
| 위키 (나무위키 · 위키백과 · Wikidata) | 20 | 나무위키 문서 + 위키백과(ko 또는 en) + Wikidata 항목 | `brand.search.namu`, `brand.wikipedia`, `brand.wikidata`. 나무위키 8, 위키백과 8, Wikidata 4 |
| YouTube | 15 | 공식 채널 + 제3자 리뷰 · 소개 영상 | 웹 검색 `site:youtube.com <브랜드>`. 공식 채널 7, 제3자 영상 8 |
| 뉴스 · 업계 매체 | 10 | 최근 2년 안의 언론 · 업계 매체 기사 3건 이상 | 웹 검색. 3건 이상 10, 1 ~ 2건 5 |
| 커뮤니티 (Reddit · 국내 커뮤니티 · 지식iN) | 10 | 제3자 질문 · 추천 글에서 브랜드가 언급됨 | 웹 검색 `site:reddit.com <브랜드>`, `brand.search.naver.cafe` 의 이용자 글(영업 · 광고 글 제외). 여러 건 10, 1건 5 |
| LinkedIn | 10 | 회사 페이지 + 활동(게시물 · 직원 연결) | 웹 검색 `site:linkedin.com/company <브랜드>`. 페이지 5, 활동 5 |

`brand.items` 는 위 6개를 이 순서 · 이 weight 로 모두 쓴다. `score` 는 0 ~ weight. 배점 합 90 을 보고서가 100점으로 환산한다. 다음(Daum) 검색은 확인하지 않는다.

## 2. E-E-A-T (4 × 25 = 100점)

페이지 하나가 아니라 점검 페이지와 거기서 바로 이어지는 회사 소개 · 저자 소개 페이지까지 본다.

| name | 25점 | 15점 안팎 | 5점 이하 |
|---|---|---|---|
| 경험 | 자체 데이터 · 사례(수치 결과) · 직접 해 본 과정이 구체적 | 사례는 있으나 수치 · 과정이 빈약 | 누구나 쓸 수 있는 일반론 |
| 전문성 | 이름 있는 저자 · 담당자 + 경력 · 자격 + 소개 페이지, 내용의 기술적 깊이 | 저자 또는 회사 전문 분야는 보이나 근거 약함 | 저자 · 전문성 표시 없음 |
| 권위 | 회사 소개 충실, 외부 인용 · 수상 · 언론 보도, sameAs 로 공식 채널 연결 | 회사 소개만 있음 | 운영 주체 정보 빈약 |
| 신뢰 | HTTPS, 연락처 · 주소 · 사업자 정보, 개인정보처리방침, 출처 표기, 게시 · 갱신일 | 일부 빠짐 | 대부분 빠짐 |

`evidence` 에 판단 근거(페이지에서 본 것)를, `fix` 에 가장 효과가 큰 개선 한 가지를 쓴다.

## 3. AI 플랫폼별 준비도 (각 100점, 평균)

각 플랫폼 점수 = 접근(40) + 내용 구조(30) + 출처 · 엔티티 신호(30). 접근은 점검 JSON 에서 계산하고, 나머지는 판단한다.

| name | 접근 40 (점검 JSON) | 내용 구조 30 | 출처 · 엔티티 30 |
|---|---|---|---|
| Google AI 오버뷰 | Googlebot 허용 · noindex 없음 · SSR | 질문형 소제목 · 즉답 문단 · 비교 표 | Organization · Article 스키마, 저자 · 날짜 |
| ChatGPT 검색 | OAI-SearchBot · ChatGPT-User 허용, bot-probe 정상 | 출처 붙은 사실 문장 | Wikipedia · Wikidata, sameAs |
| Perplexity | PerplexityBot · Perplexity-User 허용 | 짧고 직접적인 답, 수치 | 커뮤니티(Reddit 등) 언급, 최신 갱신일 |
| Gemini | Googlebot 허용(Google-Extended 차단은 감점 없음) | Google AI 오버뷰와 같음 | YouTube 채널 · 영상, Google 비즈니스 프로필 |
| Copilot | Bingbot 허용 | 명확한 제목 · 메타 설명 | LinkedIn 회사 페이지, Bing 색인 |
| 네이버 AI 브리핑 | `facts.koBots` 의 Yeti 허용, SSR | 질문형 소제목 · 즉답, 네이버 블로그 · 카페 원문과 겹치는 주제 | 네이버 검색 노출(브랜드 언급 1번 결과), 네이버 블로그 · 플레이스 등 공식 채널 |

접근 40 은 해당 봇이 모두 허용이고 SSR 통과면 40, 하나라도 차단 · SSR 실패면 0, 그 밖(SSR 주의 등)은 20. 6개 플랫폼을 이 순서로 모두 쓴다.
`strengths` 에 강점, `gaps` 에 부족한 점을 한두 문장씩 쓴다.

## review.json 형식

```json
{
  "brand": {
    "items": [
      { "platform": "네이버", "weight": 25, "score": 15, "found": "브랜드 검색 시 공식 사이트 1위, 블로그 언급 다수, 지식백과 · 뉴스 없음", "url": "https://search.naver.com/search.naver?query=..." }
    ]
  },
  "eeat": [
    { "name": "경험", "score": 12, "evidence": "…", "fix": "…" },
    { "name": "전문성", "score": 10, "evidence": "…", "fix": "…" },
    { "name": "권위", "score": 14, "evidence": "…", "fix": "…" },
    { "name": "신뢰", "score": 20, "evidence": "…", "fix": "…" }
  ],
  "platforms": [
    { "name": "Google AI 오버뷰", "score": 72, "strengths": "…", "gaps": "…" }
  ]
}
```

`render.mjs` 가 형식(개수 · 점수 범위 · 빈 문구)을 검사하고, 틀리면 보고서를 만들지 않고 오류 위치를 출력한다.

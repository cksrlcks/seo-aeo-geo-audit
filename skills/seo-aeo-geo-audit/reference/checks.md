# 점검 항목 · 채점 기준 · 근거

`scripts/audit.mjs` 가 실행하는 항목의 고정 기준이다. 기준을 바꾸려면 이 문서와 스크립트를 함께 고친다.

## 페이지 유형

| 유형 | 자동 판별 근거 | 바뀌는 섹션 |
|---|---|---|
| 메인 · 소개 (`home`) | 최종 주소가 사이트 루트(`/`, `/index.*`) | 3 즉답 문단 → 핵심 소개 문단, 4 출처 · 수치 · 갱신일 → 운영 주체 · 신뢰 정보. 구조화 데이터의 페이지 유형 스키마는 WebSite · Organization 도 인정 |
| 콘텐츠(글) (`content`) | Article 계열 스키마, og:type article, 글 주소 패턴(/blog/ · /news/ · /post/ · 날짜 등), 이름에 post · blog · news 가 들어간 하위 사이트맵에 포함 중 하나 | 기본 섹션 그대로 |
| 판별 불가 | 위 어느 것도 아님(예: /about, /service) | SKILL 이 사용자에게 묻는다. 스크립트만 단독으로 돌리면 콘텐츠 기준으로 채점하고 안내문을 남긴다 |

로그인 · 앱 화면은 따로 구분하지 않고 측정된 그대로 채점한다. 메인 · 소개 페이지에 정보형 글 기준(즉답 · 출처 · 수치 · 저자 · 날짜 · 분량)을 요구하지 않기 위해 유형을 나눈다.

## 채점 방식

- 항목 상태: 통과 1점 · 주의 0.5점 · 실패 0점. "해당 없음(na)" · "참고(info)" 는 분모에서 제외.
- 섹션 점수 = Σ(가중치 × 점수) / Σ가중치 × 100.
- 영역 점수: GEO = [AI 크롤러 접근 + 출처 · 수치 · 갱신일], AEO = [구조화 데이터 + 즉답 문단], SEO = [제목 · 메타 · 표준 URL + 기술 기본 · 페이지 경험]. 섹션 항목을 합쳐 같은 식으로 계산.
- 종합 = SEO · AEO · GEO 평균. Lighthouse 는 별도 표기(종합에 미포함).
- 점수 밴드(Lighthouse 와 동일): 90 이상 양호 · 50 ~ 89 개선 필요 · 49 이하 미흡.

## 1. AI 크롤러 접근 → GEO

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| http-status | 페이지 응답 | 3 | 200 / – / 그 외 | Google: AI 기능 노출 조건은 "색인 + 스니펫 허용". HTTP 200 필수 |
| noindex | noindex · 스니펫 제한 없음 | 3 | 지시어 없음 / nosnippet · max-snippet:0 · data-nosnippet / noindex · none | Google AI features 문서: nosnippet · data-nosnippet · max-snippet · noindex 가 AI 기능 노출도 제한 |
| robots-ai | 검색 · 인용용 AI 봇 허용 | 3 | 전부 허용 / 절반 이상 / 그 미만 | OpenAI: OAI-SearchBot 차단 시 ChatGPT 검색 미노출. 학습용(GPTBot · ClaudeBot · Google-Extended 등) 차단은 감점 없음 |
| bot-probe | AI 봇 UA 실제 요청 | 2 | 모두 2xx·3xx / 일부 403·429 / 전부 차단. 5xx · 연결 실패는 2초 뒤 한 번 더 요청한 결과로 판정 | 보안 플러그인 · WAF · CDN 의 봇 차단 규칙이 AI 봇 User-Agent 를 일괄 차단하는 경우가 많다 |
| ssr | 본문이 원본 HTML 에 포함 | 3 | 원본/렌더링 텍스트 비율 ≥ 70% / ≥ 40% / 미만 | 대부분의 AI 크롤러는 JS 미실행. Google: "중요한 콘텐츠를 텍스트로 제공" |
| llms-txt | llms.txt | 1 | 존재 + H1 + blockquote + 링크 / 존재하나 형식 미달 / 없음 | llmstxt.org 제안(비공식). Google 은 AI 전용 파일 불필요 명시 → 낮은 가중치 |
| ai-txt | ai.txt | – | 참고만 | 실험적 제안, 표준 아님 |

검색 · 인용용(감점 대상) 토큰: Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, DuckAssistBot.
학습 · 제어용(감점 없음): GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, Bytespider, CCBot, meta-externalagent, Amazonbot.
robots.txt 판정은 Google 방식(토큰 정확 일치 그룹 → `*` 그룹, 가장 긴 규칙 우선, 동률이면 Allow)으로 현재 페이지 경로에 대해 계산한다.

## 2. 구조화 데이터 → AEO

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| ld-present | JSON-LD 존재 · 파싱 | 3 | 블록 있고 전부 파싱 / 파싱 오류 또는 Microdata 만 / 없음 | Google 권장 형식 JSON-LD. 문법 오류 블록은 전체 무시 |
| ld-valid | @context · @type 유효 | 2 | schema.org 컨텍스트 + @type / 일부 누락 / – | schema.org 규격 |
| ld-content-type | 페이지 유형 스키마 | 2 | Article · WebPage · Product 등 / 엔티티만 있음 / 없음 | 글은 Article/BlogPosting(headline · author · datePublished · dateModified) |
| ld-entity | Organization/Person + sameAs | 2 | sameAs 있음 / 엔티티만 / 없음 | Google Organization 구조화 데이터: sameAs 로 공식 채널을 묶어 같은 실체로 인식 |
| ld-match | 스키마 ↔ 보이는 본문 일치 | 2 | headline 이 제목/H1 과 일치, FAQ 질문이 본문에 보임 / 불일치 / – | Google: "구조화 데이터가 보이는 텍스트와 일치해야" |
| faq-note | FAQPage 사용 중 | – | 참고만 | 2023-08 이후 FAQ 리치 결과 축소. 2026 인용 흡수 연구: FAQ 형식 전환 영향력 −5.74% |

**FAQPage · HowTo · Speakable 의 유무는 점수에 넣지 않는다.** Google: "AI 기능용 특별한 schema.org 구조화 데이터는 없다."

## 3. 즉답 문단 → AEO

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| question-headings | 질문 · 검색어형 h2/h3 비율 | 2 | ≥ 30% / ≥ 1개 / 0개 또는 소제목 없음 | 답변 엔진은 질문 단위로 발췌한다. 소제목을 사용자가 입력할 질문 형태로 |
| direct-answer | 소제목 직후 1 ~ 4문장(40 ~ 700자) 또는 리스트 · 표 | 3 | ≥ 70% / ≥ 40% / 미만 | Google 패시지 랭킹 · RAG 는 소제목 + 첫 문단을 조각으로 가져간다. 결론을 2 ~ 3문장으로 먼저 |
| intro-length | 첫 h2 이전 본문 길이 | 2 | ≤ 600자 / ≤ 1,200자 / 초과 | 설계 기준: 서론이 길면 답이 뒤로 밀린다 |
| lists-tables | 목록 · 표 개수 | 2 | ≥ 3 / ≥ 1 / 0 | 2026 인용 흡수 연구: 리스트 밀도 상위 25% 가 8.94배 |
| summary-top | 상단 요약 · 목차 | 1 | 있음 / 없음 / – | 설계 기준: 상단 요약이 페이지 주제 파악을 돕는다 |
| definition | 정의형 문장 "X란 ~이다" | 1 | ≥ 1 / 0 / – | 2026 연구: 정의 요소 영향력 +57.33% |

본문이 300어절 미만이면 summary-top · definition · quotes 는 "해당 없음", lists-tables 는 "주의"로 완화하고 리포트에 안내 문구를 붙인다.
"함께 읽기 · 참고 자료 · 관련 용어 · 목차 · 댓글" 같은 상용구 소제목은 즉답 · 질문형 비율 계산에서 제외한다.
질문 · 검색어형 판정 키워드: 물음표, 의문사(무엇 · 어떻게 · 왜 …), 이란/란 · 방법 · 방식 · 이유 · 차이 · 비교 · 관계 · 종류 · 장단점 · 정의 · 뜻 · 의미 · 실수 · how/what/why/which/should 등.
정의 문장 판정: "X란 ~이다", "X(English)는 ~입니다", 문장 첫머리 "X is a/an", "refers to / is defined as / stands for".

## 4. 출처 · 수치 · 갱신일 → GEO

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| sourced-stats | 숫자 + 출처 표지("~에 따르면", "(출처, 연도)")가 같은 문장 | 3 | ≥ 3 / ≥ 1 / 0 | GEO 논문: 통계 추가 가시성 +40%, 출처 인용 효과 높음. 2026 연구: 숫자 · 통계 +61.55% |
| outbound-sources | 본문 외부 출처 도메인 수 | 2 | ≥ 2 / 1 / 0 | GEO 논문: 출처 인용(Cite Sources) 전략이 가시성을 높였다 |
| quotes | blockquote · 따옴표 인용 | 1 | ≥ 1 / 0 / – | GEO 논문: 전문가 인용문 주관적 인상 +37% |
| author | 저자 표기 (schema author · meta · 바이라인) | 2 | 있음 / – / 없음 | E-E-A-T: 바이라인 · Person 스키마 |
| dates | 게시 · 갱신일 표기 | 2 | 있음 / – / 없음 | 설계 기준: 콘텐츠 신선도 신호 |
| freshness | 최근 갱신 | 2 | ≤ 12개월 / ≤ 24개월 / 초과 | 설계 기준 |
| length | 본문 분량(어절 근사) | 1 | ≥ 1,500 / ≥ 500 / 미만 | 2026 연구: 3,000단어 초과 글 영향력 높음. 홈 · 서비스 페이지엔 부적합 |

## 3H. 핵심 소개 문단 → AEO (메인 · 소개 페이지)

모두 원본 HTML(JavaScript 실행 전) 기준.

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| intro-sentence | 회사 · 서비스 소개 문장 | 3 | 본문 영역에 있음 / 메타 설명에만 있음 / 없음 | AI 답변은 소개 문장을 브랜드 설명으로 가져간다. 판정: 20 ~ 220자, “~다 · ~요”로 끝나는 문장이면서 다음 중 하나. 정의형 문장, 브랜드(전체 이름 또는 첫 단어)가 주어인 “~입니다 · ~합니다” 서술문, 브랜드명(또는 저희 · 당사)과 기업 · 서비스 · 플랫폼 · 제공 · 구축 등의 단어를 함께 포함. 메뉴 · 머리글 · 바닥글은 제외 |
| intro-snippet | 검색 결과 문구가 서비스를 설명 | 2 | title(10자 이상, 브랜드명만이 아님)과 description(40자 이상, 프레임워크 기본 문구 아님) 모두 적합 / 하나만 / 둘 다 아님 | 검색 결과 · AI 답변 카드의 첫인상. create-react-app · Vite 기본 문구 탐지 |
| service-text | 서비스 설명이 텍스트로 제공 | 2 | 원본 HTML 본문 150어절 이상 / 50 이상 / 미만 | Google: 중요한 콘텐츠를 텍스트로 제공 |
| section-headings | 구역별 소제목 (h2 · h3) | 1 | 2개 이상 / 1개 / 0개 | 페이지 구성을 조각 단위로 파악 |

## 4H. 운영 주체 · 신뢰 정보 → GEO (메인 · 소개 페이지)

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| trust-links | 회사 소개 · 문의 · 정책 링크 | 3 | 4종(회사 소개, 문의 · 고객센터, 개인정보처리방침, 이용약관) 중 3종 이상이고 개인정보처리방침 포함 / 1종 이상 / 0종 | 운영 주체를 확인할 수 있어야 신뢰할 출처로 본다(E-E-A-T 의 Trust) |
| business-info | 상호 · 주소 · 사업자 정보 | 2 | 사업자등록번호, 또는 상호와 주소 / 상호 · 주소 · 저작권 표기 중 일부 / 없음 | 운영 주체 신호. Organization.legalName · address 도 인정 |
| contact-info | 연락 수단 표기 | 2 | 전화 또는 이메일(텍스트, tel · mailto 링크, 스키마) / – / 없음 | 운영 주체 연락 가능성 |
| org-details | Organization 스키마 상세 | 2 | logo · url · 주소 또는 연락처 모두 / Organization 은 있으나 일부 없음 / 없음 | 운영 주체 정보를 기계가 읽게 한다 |
| site-freshness | 사이트 최근 갱신 (사이트맵 lastmod) | 1 | 가장 최근 lastmod 12개월 이내 / 24개월 이내 / 초과. lastmod 없으면 해당 없음 | 사이트가 관리되고 있다는 신호 |

## 5. 제목 · 메타 · 표준 URL → SEO

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| title | title 태그 | 3 | 1개 · 15 ~ 60자 / 길이 벗어남 · 중복 / 없음 | Google: 서술적이고 간결한 고유 title. 표시 폭 약 600px(서드파티 실측) |
| meta-description | meta description | 2 | 1개 · 50 ~ 160자 / 길이 · 중복 / 없음 | Google: 순위 요인이 아니라 스니펫 후보. 공식 상한이 없어 권장 범위만 본다 |
| canonical | canonical | 3 | 절대 URL 자기 참조 1개 / 다른 URL · 상대경로 · 복수 / 없음 | Google: canonical 은 힌트. 절대 URL · 자기 참조 · 복수 금지(복수면 무시될 수 있음) |
| lang | html lang | 1 | 있음 / – / 없음 | 접근성 · 언어 판별 |
| og | og:title · description · image | 1 | 3개 / title 만 / 없음 | 공유 · 카드 노출 |
| viewport | viewport | 1 | width=device-width / – / 없음 | 모바일 우선 색인 |
| hreflang | hreflang | 1 | 코드 유효 + 자기 참조 + x-default / x-default 없음 / 코드 오류 · 자기 참조 없음. 선언 없으면 해당 없음 | Google: ISO 코드 · 상호 참조 · x-default |

## 6. 기술 기본 · 페이지 경험 → SEO

| id | 항목 | 가중치 | 통과 / 주의 / 실패 | 근거 |
|---|---|---|---|---|
| https | HTTPS | 3 | https / – / http | 기본 신뢰 신호 |
| tls-chain | TLS 인증서 체인 검증 | 3 | Node 내장 공개 루트 저장소만으로 검증 성공 / – / 중간 인증서 누락 · 만료 · 도메인 불일치 · 자체 서명 | 브라우저는 AIA 로 중간 인증서를 받아오지만 OpenSSL 기반 크롤러 · AI 봇 대부분은 접속 실패. 검증 실패 시 스크립트는 OS 인증서 저장소(`--use-system-ca`)로 재시도해 나머지 점검을 계속한다 |
| redirects | 리다이렉트 체인 | 2 | ≤ 1홉 / ≤ 3홉 / 초과 | Googlebot 은 최대 10홉까지 추적. 최종 URL 로 1회에 도달하게 |
| robots-txt | robots.txt | 2 | 텍스트 + Sitemap 지시어 / 없음 또는 Sitemap 미기재 / HTML 반환 · 전체 차단 | RFC 9309 · Google robots.txt 문서: Sitemap 은 절대 URL. 스테이징의 Disallow: / 배포 사고 방지 |
| sitemap | XML 사이트맵 | 2 | urlset · sitemapindex / 200 이지만 XML 아님 / 없음 | sitemaps.org |
| h1 | H1 1개 | 2 | 1개 / 2개 이상 / 0개 | 문서 구조 · 접근성 관례(순위 신호는 아님) |
| heading-order | 레벨 건너뛰기 · 빈 헤딩 | 1 | 0 / ≤ 2 / 초과 | 접근성(WCAG) 헤딩 계층 |
| img-alt | 이미지 alt 비율 | 2 | ≥ 90% / ≥ 70% / 미만. 이미지 없으면 해당 없음 | Google 이미지 문서 · 접근성: 장식 이미지는 alt="" |
| internal-links | 내부 링크 · 앵커 | 2 | ≥ 5개, 모호 앵커 ≤ 20% / 적음 또는 모호 앵커 많음 / 0개 | Google: 모든 페이지는 내부 링크 1개 이상. 앵커는 서술적 |
| cwv | Core Web Vitals (Lighthouse 랩) | 2 | LCP ≤ 2.5s · CLS ≤ 0.1 · TBT ≤ 200ms 모두 / 2개 / 그 미만. Lighthouse 생략 시 해당 없음 | web.dev 임계값. INP 는 랩에서 TBT 로 대리 |

## Lighthouse (별도 표기)

성능 · 접근성 · 권장사항 · SEO 4개 카테고리 점수, LCP · CLS · TBT · FCP · Speed Index, SEO 카테고리 미통과 감사 목록. 기본 데스크톱 프리셋(CPU 1배 · 10 Mbps 모의), `--mobile` 로 모바일 프리셋(CPU 4배 감속 · 느린 4G 모의). 다른 수집이 끝난 뒤 단독으로 실행한다(동시 실행 시 TBT 가 부풀어 점수가 크게 떨어진 사례 있음). 1회 랩 측정이므로 실사용자(CrUX) 데이터와 다를 수 있다.

## 근거 자료 요약

**Google Search Central** (AI features and your website, 2025-05 블로그)
- AI 오버뷰 · AI 모드 노출에 추가 요건은 없다. 조건은 색인 가능 + 스니펫 허용.
- 권장: robots.txt · CDN 에서 크롤링 허용, 내부 링크, 좋은 페이지 경험, 중요한 콘텐츠를 텍스트로, 구조화 데이터는 보이는 텍스트와 일치.
- nosnippet · data-nosnippet · max-snippet · noindex 는 AI 기능 노출도 제한한다. Google-Extended 는 Gemini 학습 · 그라운딩 제어용이며 검색 노출 · 순위와 무관하다.
- AI 전용 파일 · 마크업 · 특별한 schema.org 타입은 필요 없다.
- FAQ · HowTo 리치 결과는 2023-08 이후 축소되었다.

**AI 크롤러 공식 문서**
- OpenAI: GPTBot(학습) · OAI-SearchBot(검색, 차단 시 ChatGPT 검색 미노출) · ChatGPT-User(사용자 요청, robots.txt 가 적용되지 않을 수 있음).
- Anthropic: ClaudeBot(학습) · Claude-SearchBot(검색) · Claude-User(사용자 요청). robots.txt 준수.
- Perplexity: PerplexityBot(검색, 학습 아님) · Perplexity-User(사용자 요청, robots.txt 를 일반적으로 무시).

**연구**
- Aggarwal et al., GEO (KDD 2024): 통계 추가(가시성 +40% 이상), 출처 인용, 전문가 인용문(주관적 인상 +37%)이 효과적이고 키워드 반복은 역효과.
- Zhang et al., Citation Absorption (2026): 인용 영향력 상위 25% 페이지는 소제목 12.5배 · 분량 11.4배 · 리스트 밀도 8.9배. 숫자 · 통계 +61.55%, 정의 +57.33%, 비교 +55.28%, FAQ 형식 전환 −5.74%. 상관관계이며 인과가 아니다.

**표준 · 기타**
- llms.txt(llmstxt.org): 마크다운, H1 → `>` 요약 → `##` 섹션 → `- [문서](URL): 설명`. 비공식 제안이며 크롤링을 통제하지 않는다.
- robots.txt(RFC 9309): 500KiB 한도, 가장 구체적인 규칙 우선, Sitemap 은 절대 URL.
- 사이트맵(sitemaps.org): 파일당 5만 URL · 50MB. Google 은 priority · changefreq 를 무시하고 정확한 lastmod 만 참고한다.
- Core Web Vitals(web.dev): LCP 2.5s · INP 200ms · CLS 0.1, 실사용자 75퍼센타일 기준. 랩 점수는 판정 기준이 아니다.

## 참고 자료

- Google Search Central, AI features and your website — https://developers.google.com/search/docs/appearance/ai-features
- Google Search Central Blog, Top ways to ensure your content performs well in Google's AI experiences on Search (2025-05) — https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search
- OpenAI crawlers — https://platform.openai.com/docs/bots
- Anthropic crawlers — https://support.anthropic.com/en/articles/8896518
- Perplexity crawlers — https://docs.perplexity.ai/guides/bots
- llms.txt — https://llmstxt.org/
- Aggarwal et al., GEO: Generative Engine Optimization — https://arxiv.org/abs/2311.09735
- Zhang et al., From Citation Selection to Citation Absorption — https://arxiv.org/abs/2604.25707
- RFC 9309 Robots Exclusion Protocol — https://www.rfc-editor.org/rfc/rfc9309
- sitemaps.org — https://www.sitemaps.org/protocol.html
- web.dev, Web Vitals — https://web.dev/articles/vitals

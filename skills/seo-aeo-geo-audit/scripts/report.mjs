// report.mjs — 점검 결과를 쪽 구분된 보고서(HTML · PDF 공용)로 만든다.
//  renderFlow(r): 장(章) · 블록 단위의 흐름 HTML. 스타일은 report.css, 규격은 reference/report-style-guide.md.
//  paginate():    브라우저 안에서 블록을 A4 쪽(.sheet)에 나눠 담고 머리글 · 쪽 번호를 채운다(audit.mjs 가 Puppeteer 로 실행).
// 쪽으로 나눈 DOM 을 저장한 것이 HTML 보고서, 같은 DOM 을 인쇄한 것이 PDF 보고서다.

import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("./report.css", import.meta.url), "utf8");
const FONT_URL = "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard-dynamic-subset.min.css";
const TITLE = "SEO · AEO · GEO 점검 보고서";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");

// ---------- 표기 규칙 (가이드 “구간 · 판정 · 우선순위 표기”) ----------
const band = (s) =>
  s == null ? { tone: "neutral", label: "측정 안 됨" } : s >= 90 ? { tone: "pass", label: "양호" } : s >= 50 ? { tone: "warn", label: "개선 필요" } : { tone: "fail", label: "미흡" };
const STATUS = { pass: ["pass", "통과"], warn: ["warn", "주의"], fail: ["fail", "실패"], na: ["neutral", "해당 없음"], info: ["neutral", "참고"] };
// 판정 표시: 판정 색 글자
const stText = (tone, label) => `<span class="st tone-${tone}">${esc(label)}</span>`;
const st = (s) => stText(...(STATUS[s] || STATUS.na));
const bandText = (score) => { const b = band(score); return stText(b.tone, b.label); };
const prio = (c) => (c.status === "fail" && c.weight === 3 ? ["fail", "즉시"] : c.status === "fail" ? ["warn", "단기"] : ["neutral", "권장"]);
// 점수 게이지: 회색 막대 위에 점수만큼 판정색 한 색 그라디언트로 채우고 끝에 흰 원
const gauge = (score) => `<span class="gauge gauge--${band(score).tone}">${score == null ? "" : `<i style="width:${score}%"></i>`}</span>`;
const worstFirst = (a, b) => (a.status === b.status ? b.weight - a.weight : a.status === "fail" ? -1 : 1);
// 요약 박스 항목: 항목명 한 줄, 측정값과 권장 기준 한 줄. 자르지 않는다.
const boxItem = (c) => `<li><b>${esc(c.title)}</b><span class="sub">측정값 ${esc(c.value)}, 권장 기준 ${esc(c.criterion)}</span></li>`;

// ---------- 고정 문구 ----------
const NON_GUARANTEES = [
  "특정 질문에 반드시 인용된다는 보장",
  "고정된 “AI 검색 순위”",
  "모든 엔진(ChatGPT, Perplexity, Google AI 오버뷰 등)에서 동일한 결과",
  "경쟁사 대비 항상 우위",
];
// 섹션 제목 아래 한 줄: 무엇을 보는지 명사형으로
const SECTION_Q = {
  "AI 크롤러 접근": "검색엔진 · AI 크롤러의 페이지 접근 가능 여부",
  "구조화 데이터": "schema.org 마크업의 유효성과 화면 내용 일치 여부",
  "즉답 문단": "질문형 소제목 아래 바로 답하는 문단 유무",
  "출처 · 수치 · 갱신일": "출처 · 수치 · 저자 · 갱신일 표기 여부",
  "제목 · 메타 · 표준 URL": "제목 · 메타 설명 · 표준 URL 설정 상태",
  "기술 기본 · 페이지 경험": "크롤링 · 색인 기본 요건과 Core Web Vitals 충족 여부",
  "핵심 소개 문단": "회사 · 서비스를 한두 문장으로 소개하는 텍스트 유무",
  "운영 주체 · 신뢰 정보": "운영 주체와 신뢰 정보 표기 여부",
};
const SECTION_NOTE = {
  "AI 크롤러 접근": "검색엔진과 AI 서비스가 페이지를 가져가지 못하면 그 뒤의 최적화는 효과가 없습니다. robots.txt 규칙, 봇 요청에 대한 서버 응답, 색인 · 스니펫 지시어, JavaScript 없이 본문이 읽히는지를 봅니다.",
  "구조화 데이터": "schema.org 마크업은 페이지가 무엇에 관한 것이고 누가 운영하는지를 기계가 읽게 합니다. 있는지보다 문법이 유효한지, 화면 내용과 일치하는지가 중요합니다.",
  "즉답 문단": "답변 엔진은 페이지 전체가 아니라 소제목과 그 아래 첫 문단을 하나의 조각으로 가져갑니다. 질문형 소제목 바로 아래에 결론이 있어야 발췌됩니다.",
  "출처 · 수치 · 갱신일": "생성형 엔진은 근거가 붙은 문장을 선호합니다. GEO 연구에서 통계, 출처, 인용문 추가가 가시성을 가장 크게 높였고, 저자와 갱신일은 신뢰 판단의 기본 신호입니다.",
  "제목 · 메타 · 표준 URL": "검색 결과와 AI 답변 카드에 그대로 노출되는 요소입니다. 페이지마다 고유해야 하고, 표준 URL 은 같은 내용을 가리키는 여러 주소의 신호를 하나로 모읍니다.",
  "기술 기본 · 페이지 경험": "HTTPS, 인증서, 사이트맵, 헤딩 구조, 이미지 대체 텍스트, Core Web Vitals 는 검색엔진과 AI 서비스가 공통으로 전제하는 조건입니다.",
  "핵심 소개 문단": "AI 답변이 브랜드를 설명할 때 가져가는 것은 메인 페이지의 소개 문장과 검색 결과 문구입니다. 회사나 서비스가 무엇을 하는지 한두 문장으로 밝힌 텍스트가 JavaScript 없이도 읽히는지를 봅니다.",
  "운영 주체 · 신뢰 정보": "메인 페이지의 신뢰 신호는 글의 저자나 출처가 아니라 누가 운영하는지입니다. 회사 소개 · 문의 · 정책 링크, 상호 · 주소 · 연락처, Organization 스키마, 사이트 갱신 여부를 봅니다.",
};
const PAGE_TYPE_LABEL = { home: "메인 · 소개 페이지", content: "콘텐츠(글) 페이지" };
const REFERENCES = [
  ["Google Search Central, AI features and your website", "https://developers.google.com/search/docs/appearance/ai-features"],
  ["Google Search Central Blog, Top ways to ensure your content performs well in Google's AI experiences on Search (2025-05)", "https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search"],
  ["OpenAI, Overview of OpenAI crawlers", "https://platform.openai.com/docs/bots"],
  ["Anthropic, Does Anthropic crawl data from the web, and how can site owners block the crawler?", "https://support.anthropic.com/en/articles/8896518"],
  ["Perplexity, Perplexity crawlers", "https://docs.perplexity.ai/guides/bots"],
  ["llms.txt 제안 규격", "https://llmstxt.org/"],
  ["Aggarwal et al., GEO: Generative Engine Optimization, KDD 2024", "https://arxiv.org/abs/2311.09735"],
  ["Zhang et al., From Citation Selection to Citation Absorption, 2026", "https://arxiv.org/abs/2604.25707"],
  ["web.dev, Web Vitals", "https://web.dev/articles/vitals"],
];
const GLOSSARY = [
  ["SEO", "검색엔진 최적화. 검색 결과 상위 노출을 위해 콘텐츠, 구조, 기술 요소를 다듬는 작업."],
  ["AEO", "답변 엔진 최적화. ChatGPT, Perplexity, Google AI 오버뷰처럼 완성된 답을 만드는 서비스가 내 콘텐츠를 답의 재료와 출처로 고르도록 하는 작업."],
  ["GEO", "생성형 엔진 최적화. 생성형 AI 가 답변을 만들 때 내 콘텐츠를 근거로 인용하도록 하는 방법론. 실무 항목은 AEO 와 대부분 겹친다."],
  ["AI 크롤러", "AI 서비스가 웹을 수집하는 봇. 학습용(GPTBot, ClaudeBot), 검색 · 인용용(OAI-SearchBot, Claude-SearchBot, PerplexityBot), 사용자 요청용(ChatGPT-User 등)으로 나뉜다."],
  ["구조화 데이터", "schema.org 어휘를 JSON-LD 등으로 적어 페이지의 의미를 기계가 읽게 하는 마크업."],
  ["llms.txt", "사이트 루트에 두는 마크다운 파일로, LLM 에이전트가 먼저 읽을 핵심 문서를 안내한다. 비공식 제안이며 크롤링을 통제하지 않는다."],
  ["Core Web Vitals", "Google 이 정한 페이지 경험 지표. LCP 2.5초, INP 200ms, CLS 0.1 이하가 ‘좋음’."],
  ["E-E-A-T", "경험, 전문성, 권위성, 신뢰성. Google 품질 평가 기준이며 저자 정보, 출처, 운영 주체 표기가 대표 신호."],
];

// ---------- 컴포넌트 ----------
// 안내 배너 아이콘(lucide lightbulb)
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
// 섹션 머리: 번호 · 제목 · 부제, 오른쪽 점수 블록(한눈에 보기 종합 점수와 같은 구성), 아래 남색 2px 선, 그 아래 설명.
// scoreRows: [[라벨, 값, 톤]] — 점수표 왼쪽 칸에 가로로 나열(점수는 오른쪽 칸). 값이 0 이면 검정. rowsLabel 은 왼쪽 칸 머리.
function secHead({ num = "", cat = "", title, q = "", score, scoreLabel = "섹션 점수", scoreRows = [], rowsLabel = "점검 결과", desc = "", note = "" }) {
  const b = band(score);
  // 라벨은 판정색(참고는 검정), 값은 0 이 아니면 판정색 · 0 이거나 참고면 검정
  const items = scoreRows.map(([k, v, t]) => { const c = t === "neutral" ? "" : `tone-${t}`; return `<div><span class="${c}">${k}</span><b class="${v ? c : ""}">${v}</b></div>`; }).join("");
  const scoreBlock = score === undefined ? "" : `<div class="sec-score"><table class="grade"><thead><tr>${items ? `<th>${esc(rowsLabel)}</th>` : ""}<th class="grade-head-score">${esc(scoreLabel)}</th></tr></thead><tbody><tr>${items ? `<td class="grade-items"><div class="grade-list">${items}</div></td>` : ""}<td class="grade-score"><b>${score ?? "–"}</b><span class="tone-${b.tone}">${b.label}</span></td></tr></tbody></table></div>`;
  return `<header class="sec-head">
<div class="sec-top"><div class="sec-title">${num ? `<p class="sec-num">${esc(num)}</p>` : ""}<h2>${esc(title)}${cat ? `<span class="sec-cat">${esc(cat)} 영역</span>` : ""}</h2>${q ? `<p class="sec-q">${esc(q)}</p>` : ""}</div>${scoreBlock}</div>
${desc ? `<p class="sec-desc">${desc}</p>` : ""}${note ? `<div class="sec-note">${BULB}<p>${esc(note)}</p></div>` : ""}
</header>`;
}

// 종합 점수 원형 차트: 판정 구간 두 색 원뿔 그라디언트(시작 밝게 → 끝 선명), 시작 · 끝은 둥글게, 끝에 흰 원 핸들. 가운데 점수만
function ring(score, px = 132, label = "종합 점수") {
  const b = band(score);
  return `<div class="ring ring--${b.tone}" style="--p:${score ?? 0}; --size:${px}px" role="img" aria-label="${label} ${score ?? "측정 안 됨"}점, ${b.label}">${score ? '<i class="ring-cap"></i><i class="ring-end"></i>' : ""}<span class="ring-num">${score ?? "–"}</span></div>`;
}

// 종합 점수표: 원형 차트 + 구간 · 설명 + SEO · AEO · GEO 막대
function scoreCard(r, detail) {
  const b = band(r.overall);
  const cats = [["SEO", "검색 엔진"], ["AEO", "답변 엔진"], ["GEO", "생성형 엔진"]].map(([n, l]) => {
    const s = r.categories.find((c) => c.name === n)?.score ?? null;
    return `<div class="score-cat"><span><b class="cat-name">${n}</b> ${l}</span><b class="tone-${band(s).tone}">${s ?? "–"}${s == null ? "" : '<span class="unit">점</span>'}</b>${gauge(s)}</div>`;
  });
  return `<div class="score-card">${ring(r.overall)}
<div class="score-text"><p class="score-title">종합 점수</p><p class="score-band tone-${b.tone}">${r.overall ?? "–"}점 · ${b.label}</p><p class="score-detail">${detail}</p></div>
<div class="score-cats">${cats.join("")}</div></div>`;
}

// 지표 카드. items: [값, 라벨, 톤, 단위]
const statCards = (items) =>
  `<div class="stats">${items.map(([v, label, tone, unit = ""]) => `<div class="stat stat--${tone}"><p class="stat-label">${esc(label)}</p><p class="stat-value">${esc(v)}${unit ? `<span>${esc(unit)}</span>` : ""}</p></div>`).join("")}</div>`;
const scoreStat = (score, label) => [score ?? "–", label, band(score).tone, score == null ? "" : "/ 100"];

const table = (cols, head, rows, cls = "tbl") =>
  `<table class="${cls}"><colgroup>${cols.map((w) => (w ? `<col style="width:${w}">` : "<col>")).join("")}</colgroup>
<thead><tr>${head.map((h) => (typeof h === "string" ? `<th>${h}</th>` : `<th class="${h[1]}">${h[0]}</th>`)).join("")}</tr></thead>
<tbody>${rows.join("")}</tbody></table>`;

function checksTable(list) {
  return table(["36mm", "24mm", "27mm", "15mm", ""], ["점검 항목", "측정값", "권장 기준", "판정", "진단 내용 · 개선 방법"], list.map((c) => {
    const fix = !c.fix ? "" : c.status === "warn" || c.status === "fail" ? `<span class="fix"><b>개선</b>${esc(c.fix)}</span>` : c.status !== "pass" ? `<span class="sub">${esc(c.fix)}</span>` : "";
    return `<tr><td>${esc(c.title)}<span class="sub">가중치 ${c.weight}</span></td><td>${esc(c.value)}</td><td class="muted">${esc(c.criterion)}</td><td>${st(c.status)}</td><td>${esc(c.detail)}${fix}</td></tr>`;
  }));
}

function botsTable(bots) {
  return table(["34mm", "22mm", "40mm", "", "24mm"], ["봇", "운영사", "용도", "robots.txt", "실제 요청"], bots.map((b) => {
    const rule = b.allowed ? stText("pass", "허용") : b.citation ? stText("fail", "차단") : stText("neutral", "차단 (정책 선택)");
    const probe = b.probe == null ? '<span class="muted">–</span>' : stText(b.probe >= 200 && b.probe < 400 ? "pass" : "fail", `HTTP ${b.probe}`);
    return `<tr><td>${esc(b.token)}</td><td>${esc(b.vendor)}</td><td>${esc(b.role)}</td><td>${rule}<span class="sub">${esc(b.rule)}</span></td><td>${probe}</td></tr>`;
  }));
}

const chapter = (id, label, blocks, { pageBreak = true, kind = "" } = {}) =>
  `<section class="chapter" data-id="${id}" data-label="${esc(label)}"${pageBreak ? ' data-break="page"' : ""}${kind ? ` data-kind="${kind}"` : ""}>\n${blocks.filter(Boolean).join("\n")}\n</section>`;

// ---------- 문서 ----------
export function renderFlow(r) {
  const d = new Date(r.auditedAt);
  const dateStr = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const lh = r.lighthouse || {};
  const lhOk = !!lh.scores;
  const ff = r.formFactor === "desktop" ? "데스크톱" : "모바일";
  const perf = lh.scores?.performance ?? null;
  const scored = r.checks.filter((c) => c.score !== null);
  const n = { pass: 0, warn: 0, fail: 0 };
  scored.forEach((c) => n[c.status]++);
  const issues = r.checks.filter((c) => c.status === "fail" || c.status === "warn").sort(worstFirst);
  const strengths = r.checks.filter((c) => c.status === "pass").sort((a, b) => b.weight - a.weight).slice(0, 4);
  const m = lh.metrics || {};
  const metricLine = lhOk ? `LCP ${(m.lcp / 1000).toFixed(2)}s, CLS ${m.cls?.toFixed(3)}, TBT ${Math.round(m.tbt)}ms` : "측정 안 됨";
  const typeLabel = PAGE_TYPE_LABEL[r.pageType] || PAGE_TYPE_LABEL.content;
  const typeInfo = r.pageTypeInfo || {};
  const typeHow = typeInfo.source === "지정" ? "직접 지정" : typeInfo.confident ? "자동 판별" : "자동 판별 실패, 콘텐츠 기준";

  // 표지
  const cover = chapter("cover", "표지", [
    `<div class="cover-top">
<div class="cover-kicker"><span>웹사이트 점검 보고서</span></div>
<div class="cover-head"><h1 class="cover-title">SEO · AEO · GEO 노출 준비 상태 진단</h1><p class="cover-subject">${esc(r.host)}</p><p class="cover-url">${esc(r.finalUrl)}</p></div>
</div>`,
    `<div class="cover">
<div class="callout cover-callout"><h4>이 보고서가 보장하지 않는 것</h4><ul>${NON_GUARANTEES.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><p class="caption">실제 인용 여부는 각 AI 서비스의 정책, 질문, 경쟁 문서에 따라 달라집니다. 이 보고서는 그 전제 조건이 갖춰졌는지를 측정합니다.</p></div>
<dl class="cover-meta">
<div><dt>점검 일시</dt><dd>${dateStr}</dd></div>
<div><dt>Lighthouse</dt><dd>${lhOk ? `v${esc(lh.version)} ${ff}` : "측정 안 됨"}</dd></div>
<div><dt>${r.author ? "작성" : "생성 도구"}</dt><dd>${esc(r.author || `${r.tool} v${r.version}`)}</dd></div>
</dl>
<p class="caption cover-note">이 보고서는 공개된 HTML, HTTP 응답, robots.txt, 사이트맵, llms.txt 와 Lighthouse 랩 측정으로 확인할 수 있는 조건만 점검합니다.</p>
</div>`,
  ], { kind: "cover" });

  // 한눈에 보기
  const sectionSummary = (s) => {
    const list = r.checks.filter((c) => c.section === s.name);
    const bad = list.filter((c) => c.status === "fail" || c.status === "warn").sort(worstFirst);
    return bad.length ? `${bad[0].title}${bad.length > 1 ? ` 외 ${bad.length - 1}건` : ""} 개선 필요` : `채점 항목 ${list.filter((c) => c.score !== null).length}개 모두 통과`;
  };
  const summaryRow = (name, area, score, summary, pageOf) =>
    `<tr><td>${esc(name)}</td><td class="muted">${esc(area)}</td><td class="num"><b>${score ?? "–"}</b></td><td>${bandText(score)}</td><td>${esc(summary)}</td><td class="ctr muted" data-page-of="${pageOf}"></td></tr>`;
  const summary = chapter("summary", "한눈에 보기", [
    secHead({ title: "한눈에 보기", q: "종합 점수와 섹션별 결과" }),
    scoreCard(r, `SEO · AEO · GEO 세 영역 점수의 평균이며 ${typeLabel} 기준으로 채점했습니다. Lighthouse 점수는 별도로 표기합니다.`),
    statCards([
      [n.pass, "통과 항목", "pass", `/ ${scored.length}`],
      [n.warn, "주의 항목", n.warn ? "warn" : "neutral", "건"],
      [n.fail, "실패 항목", n.fail ? "fail" : "neutral", "건"],
      scoreStat(perf, `Lighthouse 성능(${r.formFactor === "desktop" ? "PC" : "모바일"}기준)`),
    ]),
    table(["42mm", "12mm", "12mm", "19mm", "", "14mm"], ["섹션", "영역", ["점수", "num"], "판정", "요약", ["쪽", "ctr"]], [
      ...r.sections.map((s, i) => summaryRow(s.name, s.category, s.score, sectionSummary(s), `s${i + 1}`)),
      summaryRow("Lighthouse 성능", "별도", perf, metricLine, "lighthouse"),
    ]),
    `<div class="duo">
<section class="box box--good"><h4>잘 되어 있는 것</h4>${strengths.length ? `<ul>${strengths.map(boxItem).join("")}</ul>` : "<p>통과한 항목이 없습니다.</p>"}</section>
<section class="box box--bad"><h4>수정해야 할 것</h4>${issues.length ? `<ul>${issues.slice(0, 4).map(boxItem).join("")}</ul>${issues.length > 4 ? `<p class="caption">외 ${issues.length - 4}건은 개선 로드맵에 있습니다.</p>` : ""}` : "<p>실패 · 주의 항목이 없습니다.</p>"}</section>
</div>`,
  ]);

  // 섹션 01 ~ 06
  const sections = r.sections.map((s, i) => {
    const c = s.counts;
    const extra = c.na + c.info;
    return chapter(`s${i + 1}`, `${pad(i + 1)}  ${s.name}`, [
      secHead({
        num: pad(i + 1),
        title: s.name,
        q: SECTION_Q[s.name],
        score: s.score,
        cat: s.category,
        scoreRows: [["통과", c.pass, "pass"], ["주의", c.warn, "warn"], ["실패", c.fail, "fail"], ...(extra ? [["참고", extra, "neutral"]] : [])],
        note: SECTION_NOTE[s.name],
      }),
      checksTable(r.checks.filter((x) => x.section === s.name)),
      ...(s.name === "AI 크롤러 접근"
        ? [`<h3>AI 크롤러별 판정</h3>`, botsTable(r.bots), `<p class="caption">학습용 봇의 차단은 정책 선택으로 보아 감점하지 않습니다. 검색 · 인용 · 사용자 요청용 봇이 차단되면 해당 서비스의 답변에 인용될 경로가 막히므로 감점합니다.</p>`]
        : []),
    ]);
  });

  // 섹션 07 Lighthouse
  const ms = (v) => (v == null ? "–" : Math.round(v) + "ms");
  const sec = (v) => (v == null ? "–" : (v / 1000).toFixed(2) + "s");
  const cwv = [
    ["LCP", "최대 콘텐츠 표시 시간", sec(m.lcp), "2.5s 이하", m.lcp <= 2500, "첫 화면에서 가장 큰 요소가 그려지는 시간입니다. 첫 화면 이미지를 우선 로드하고 서버 응답을 줄이면 개선됩니다."],
    ["CLS", "누적 레이아웃 이동", m.cls == null ? "–" : m.cls.toFixed(3), "0.1 이하", m.cls <= 0.1, "로딩 중 요소가 밀리는 정도입니다. 이미지와 광고 영역의 크기를 미리 지정하면 개선됩니다."],
    ["TBT", "총 차단 시간 (INP 대리)", ms(m.tbt), "200ms 이하", m.tbt <= 200, "메인 스레드가 막힌 시간입니다. 긴 스크립트를 나누고 불필요한 JavaScript 를 줄이면 개선됩니다."],
    ["FCP", "첫 콘텐츠 표시 시간", sec(m.fcp), "1.8s 이하", m.fcp <= 1800, "첫 텍스트나 이미지가 보이는 시간입니다."],
    ["Speed Index", "화면 채움 속도", sec(m.si), "3.4s 이하", m.si <= 3400, "화면이 시각적으로 채워지는 속도의 평균입니다."],
  ];
  const lhNum = pad(r.sections.length + 1);
  const lighthouse = chapter("lighthouse", `${lhNum}  Lighthouse 성능`, lhOk
    ? [
        secHead({
          num: lhNum,
          title: "Lighthouse 성능",
          q: `${ff} 프리셋 랩 측정`,
          score: perf,
          scoreLabel: "성능 점수",
          rowsLabel: "핵심 지표",
          scoreRows: cwv.slice(0, 3).map(([k, , v, , ok]) => [k, v, v === "–" ? "neutral" : ok ? "pass" : "warn"]),
          desc: `Lighthouse ${esc(lh.version)} 을 ${ff} 프리셋으로 1회 실행한 결과입니다. Lighthouse 점수는 종합 점수에 넣지 않습니다.`,
          note: `${ff === "데스크톱" ? "데스크톱 프리셋은 CPU 1배, 10 Mbps 모의 네트워크" : "모바일 프리셋은 CPU 4배 감속, 느린 4G 모의 네트워크"}로 측정합니다. 랩 측정값이라 시점에 따라 달라지며, Google 의 판정은 실사용자 데이터(CrUX)의 75번째 백분위수를 기준으로 합니다.`,
        }),
        statCards([scoreStat(lh.scores.performance, "성능"), scoreStat(lh.scores.accessibility, "접근성"), scoreStat(lh.scores["best-practices"], "권장사항"), scoreStat(lh.scores.seo, "SEO")]),
        `<h3>Core Web Vitals</h3>`,
        table(["36mm", "24mm", "27mm", "15mm", ""], ["지표", "측정값", "권장 기준", "판정", "설명"],
          cwv.map(([k, sub, v, crit, ok, dsc]) => `<tr><td>${k}<span class="sub">${sub}</span></td><td>${v}</td><td class="muted">${crit}</td><td>${v === "–" ? st("na") : st(ok ? "pass" : "warn")}</td><td>${dsc}</td></tr>`)),
        `<h3>Lighthouse SEO 감사</h3>`,
        lh.failingSeo?.length
          ? `<ul class="list">${lh.failingSeo.map((a) => `<li>${esc(a.title)}</li>`).join("")}</ul>`
          : `<p>크롤링 가능 여부, 문서 제목, 메타 설명, 링크 텍스트, 이미지 alt, hreflang, canonical 등 Lighthouse 의 SEO 감사 항목을 모두 통과했습니다.</p>`,
      ]
    : [secHead({ num: lhNum, title: "Lighthouse 성능", desc: `Lighthouse 측정을 ${lh.skipped ? "건너뛰었습니다" : "실행하지 못했습니다"} (${esc(lh.reason || lh.error || "알 수 없음")}). Core Web Vitals 항목은 해당 없음으로 처리했습니다.` })]);

  // 개선 로드맵: 우선순위 범례(건수 · 기준) + 과제 표
  const prioCount = (label) => issues.filter((c) => prio(c)[1] === label).length;
  const prioLegend = `<div class="prio">${[
    ["즉시", "fail", "노출 자체를 막거나 신뢰를 크게 깎는 가중치 3 실패 항목"],
    ["단기", "warn", "그 밖의 실패 항목"],
    ["권장", "neutral", "주의 항목"],
  ].map(([label, tone, dsc]) => { const k = prioCount(label); return `<div class="prio--${tone}"><div class="prio-top"><p class="prio-label tone-${tone}">${label}</p><p class="prio-n">${k}<span>건</span></p></div><p class="prio-desc">${dsc}</p></div>`; }).join("")}</div>`;
  const roadmap = chapter("roadmap", "개선 로드맵", [
    secHead({ title: "개선 로드맵", q: "우선순위별 수정 과제" }),
    prioLegend,
    issues.length
      ? table(["11mm", "15mm", "44mm", "24mm", ""], [["순위", "ctr"], "구분", "과제", "측정값", "개선 방법"], issues.map((c, i) => {
          const [tone, label] = prio(c);
          return `<tr><td class="ctr">${i + 1}</td><td>${stText(tone, label)}</td><td><b>${esc(c.title)}</b><span class="sub">${esc(c.section)} · ${esc(c.category)}</span></td><td>${esc(c.value)}</td><td>${esc(c.fix || c.detail)}</td></tr>`;
        }))
      : "",
    `<h3>다음 점검</h3>`,
    `<p>콘텐츠, 템플릿, robots.txt 가 바뀐 뒤 또는 분기마다 같은 URL 을 같은 도구로 다시 점검하면 점수를 그대로 비교할 수 있습니다. 홈 · 서비스 페이지와 대표 글 페이지를 함께 점검하면 사이트 전체의 경향을 볼 수 있습니다.</p>`,
  ]);

  // 부록
  const appendix = chapter("appendix", "부록", [
    secHead({ title: "부록", q: "점검 방법, 채점 기준, 참고 자료, 용어", desc: "모든 항목과 기준은 고정되어 있어 다른 시점, 다른 페이지의 결과와 그대로 비교할 수 있습니다." }),
    `<h3>대상과 방법</h3>`,
    table(["30mm", ""], ["항목", "내용"], [
      ["입력 URL", esc(r.url)],
      ["최종 URL", esc(r.finalUrl)],
      ["점검 일시", dateStr],
      ["페이지 유형", `${esc(typeLabel)} (${esc(typeHow)}). 근거: ${esc((typeInfo.reasons || []).join(", ") || "없음")}`],
      ["원본 HTML", "브라우저 User-Agent 로 받은 HTML 을 정적 분석합니다. title, meta, canonical, 헤딩, 링크, 이미지, JSON-LD, 본문 문장."],
      ["렌더링 비교", "Chrome 으로 렌더링한 본문 텍스트 길이와 원본 HTML 텍스트 길이를 비교해 JavaScript 의존도를 봅니다."],
      ["크롤러 접근", "/robots.txt 를 Google 방식으로 해석해 AI 봇 17종의 허용 여부를 판정하고, 4종 봇 User-Agent 로 실제 요청해 응답 코드를 확인합니다."],
      ["보조 파일", "/sitemap.xml(robots.txt 의 Sitemap 지시어 우선), /llms.txt, /ai.txt, TLS 인증서 체인."],
      ["Lighthouse", lhOk ? `v${esc(lh.version)} ${ff} 프리셋, 성능 · 접근성 · 권장사항 · SEO.` : "측정 안 됨."],
    ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`), "tbl tbl--kv"),
    r.notes?.length ? `<div class="callout"><h4>점검 시 참고</h4><ul>${r.notes.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : "",
    `<h3>채점 방식</h3>`,
    `<ul class="list">
<li>항목마다 통과 1점, 주의 0.5점, 실패 0점을 주고 가중치(1 ~ 3)를 곱해 섹션 점수를 100점으로 환산합니다. 해당 없음과 참고 항목은 계산에서 제외합니다.</li>
<li>${["GEO", "AEO", "SEO"].map((c) => `${c} 는 ${r.sections.filter((s) => s.category === c).map((s) => s.name).join("과 ")}`).join(", ")} 섹션의 항목을 모아 같은 방식으로 계산합니다. 종합 점수는 세 영역의 평균입니다.</li>
<li>페이지 유형에 따라 두 섹션이 바뀝니다. 콘텐츠(글) 페이지는 즉답 문단과 출처 · 수치 · 갱신일을, 메인 · 소개 페이지는 핵심 소개 문단과 운영 주체 · 신뢰 정보를 봅니다. 정보형 글에 맞춘 항목을 메인 페이지에 요구하지 않기 위해서입니다.</li>
<li>점수 구간은 Lighthouse 와 같습니다. 90 이상 양호, 50 ~ 89 개선 필요, 49 이하 미흡.</li>
<li>FAQPage, HowTo, Speakable 스키마의 유무는 점수에 넣지 않습니다. Google 은 AI 기능 노출에 별도 스키마가 필요 없다고 명시했고, FAQ · HowTo 리치 결과는 2023년 이후 축소되었습니다.</li>
<li>학습용 AI 봇(GPTBot, ClaudeBot, Google-Extended 등)의 차단은 사이트의 정책 선택이므로 감점하지 않습니다. llms.txt 는 비공식 제안이라 가중치 1, ai.txt 는 참고 항목입니다.</li>
<li>즉답, 출처, 수치, 정의 문장은 규칙 기반으로 측정하므로 사람이 읽은 판단과 다를 수 있습니다. 진단 내용에 예시 문장을 남겨 검증할 수 있게 했습니다.</li>
<li>항목별 가중치와 권장 기준은 각 섹션 표에 있습니다.</li>
</ul>`,
    `<h3>참고 자료</h3>`,
    `<ol class="refs">${REFERENCES.map(([t, u]) => `<li>${esc(t)}<span class="sub">${esc(u)}</span></li>`).join("")}</ol>`,
    `<h3>용어</h3>`,
    table(["30mm", ""], ["용어", "뜻"], GLOSSARY.map(([t, v]) => `<tr><th>${esc(t)}</th><td>${esc(v)}</td></tr>`), "tbl tbl--kv"),
  ]);

  const meta = { head: `${r.host}  |  ${TITLE}`, foot: r.author || `${r.tool} v${r.version}` };
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)} — ${esc(r.host)}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="${FONT_URL}">
<style>${CSS}</style>
</head><body>
<header class="toolbar"><p><b>${esc(TITLE)}</b>${esc(r.host)}</p><div class="toolbar-actions"><span data-total></span><button class="btn" type="button" onclick="print()">인쇄 또는 PDF 저장</button></div></header>
<main class="book" id="book"></main>
<div id="flow">
${[cover, summary, ...sections, lighthouse, roadmap, appendix].join("\n")}
</div>
<script type="application/json" id="report-meta">${JSON.stringify(meta).replace(/</g, "\\u003c")}</script>
<script>(()=>{const f=()=>document.documentElement.style.setProperty("--fit",Math.min(1,(innerWidth-16)/794).toFixed(3));f();addEventListener("resize",f);})();</script>
</body></html>`;
}

// ---------- 쪽 나누기 (브라우저에서 실행. 바깥 변수를 쓰지 않는다) ----------
export function paginate() {
  const SLACK = 19; // ponytail: 쪽 바닥 약 5mm 여유. 오프라인 열람 시 시스템 글꼴로 바뀌어도 넘치지 않게. 부족하면 웹폰트 내장으로 전환
  const KEEP = "h3, h4, .sec-head, .cont"; // 다음 블록과 같은 쪽에 둘 것
  const flow = document.getElementById("flow");
  const book = document.getElementById("book");
  const meta = JSON.parse(document.getElementById("report-meta").textContent);
  const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

  // 숫자 묶음을 <span class="n"> 으로 감싼다(자간을 좁히려고). SVG 안은 제외.
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (/\d/.test(t.data) && !t.parentElement.closest("svg") ? 1 : 2) });
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    const frag = document.createDocumentFragment();
    t.data.split(/(\d+(?:[.,:]\d+)*)/).forEach((part, i) => {
      if (!part) return;
      frag.append(i % 2 ? Object.assign(document.createElement("span"), { className: "n", textContent: part }) : part);
    });
    t.replaceWith(frag);
  }

  const newSheet = () => {
    const sheet = el("section", "sheet");
    const body = el("div", "sheet-body");
    sheet.append(el("header", "run-head", `<span>${esc(meta.head)}</span><span class="run-label"></span>`), body, el("footer", "run-foot", `<span>${esc(meta.foot)}</span><span class="pg"></span>`));
    book.append(sheet);
    return body;
  };
  const limit = (body) => body.getBoundingClientRect().bottom - SLACK;
  const fits = (body) => !body.lastElementChild || body.lastElementChild.getBoundingClientRect().bottom <= limit(body);
  const pieces = (b) => (b.matches("table") ? [...(b.tBodies[0]?.rows || [])] : b.matches("ul, ol") ? [...b.children] : null);
  const shell = (b, items, kept) => {
    const s = b.cloneNode(false);
    delete s.dataset.start;
    if (b.matches("table")) {
      for (const c of b.children) if (c.tagName !== "TBODY") s.append(c.cloneNode(true));
      const tb = document.createElement("tbody");
      tb.append(...items);
      s.append(tb);
    } else {
      if (b.matches("ol")) s.start = (b.start || 1) + kept;
      s.append(...items);
    }
    return s;
  };

  let body = null;
  for (const ch of [...flow.children]) {
    if (ch.dataset.kind === "cover") {
      const sheet = el("section", "sheet sheet--cover");
      sheet.append(...ch.childNodes);
      book.append(sheet);
      body = null;
      continue;
    }
    const queue = [...ch.children];
    queue.forEach((b) => (b.dataset.label = ch.dataset.label));
    if (queue[0]) queue[0].dataset.start = ch.dataset.id;
    if (!body || ch.dataset.break === "page") body = newSheet();
    while (queue.length) {
      const blk = queue.shift();
      body.append(blk);
      if (fits(body)) continue;
      // 표 · 목록은 행 단위로 나눈다. 이 쪽에 두 행 이상 남을 때만. 다음 쪽 맨 위에 “이어짐” 표시를 둔다.
      const items = pieces(blk);
      if (items && items.length > 2) {
        const lim = limit(body);
        let at = items.findIndex((x) => x.getBoundingClientRect().bottom > lim);
        if (at === -1) at = items.length - 1;
        if (items.length - at < 2) at = items.length - 2; // 다음 쪽에 한 행만 남기지 않는다
        if (at >= 2) {
          const rest = shell(blk, items.slice(at), at);
          if (blk.matches("table")) {
            const cont = el("p", "cont", "앞 쪽 표에서 이어집니다");
            cont.dataset.label = blk.dataset.label;
            queue.unshift(rest);
            queue.unshift(cont);
          } else queue.unshift(rest);
          body = newSheet();
          continue;
        }
      }
      // 블록째 다음 쪽으로. 바로 앞의 섹션 머리 · 소제목도 함께 옮긴다.
      const carry = [];
      let prev = blk.previousElementSibling;
      while (prev && prev.matches(KEEP)) { carry.unshift(prev); prev = prev.previousElementSibling; }
      if (!prev) continue; // 이 쪽에 이 블록(과 제목)뿐이면 옮겨도 소용없다
      body = newSheet();
      body.append(...carry);
      queue.unshift(blk);
    }
  }

  flow.remove();
  document.getElementById("report-meta").remove();
  const sheets = [...book.children];
  sheets.forEach((s, i) => {
    const pg = s.querySelector(".pg");
    if (pg) pg.textContent = `${i + 1} / ${sheets.length}`;
    const label = s.querySelector(".run-label");
    const first = s.querySelector(".sheet-body > [data-label]");
    if (label && first) label.textContent = first.dataset.label;
  });
  const startPage = {};
  document.querySelectorAll("[data-start]").forEach((e) => (startPage[e.dataset.start] = sheets.indexOf(e.closest(".sheet")) + 1));
  document.querySelectorAll("[data-page-of]").forEach((e) => (e.textContent = startPage[e.dataset.pageOf] ?? ""));
  document.querySelectorAll("[data-total]").forEach((e) => (e.textContent = `전체 ${sheets.length}쪽`));
  return sheets.length;
}

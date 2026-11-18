#!/usr/bin/env node
// audit.mjs — URL 하나를 SEO · AEO · GEO 관점에서 점검하고 JSON · HTML · PDF 리포트를 만든다.
// 사용법: node audit.mjs <url> [--out <dir>] [--desktop] [--skip-lighthouse] [--no-pdf]

import { load } from "cheerio";
import { execFile, spawnSync } from "node:child_process";
import tls from "node:tls";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";
import { paginate, renderFlow } from "./report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 버전은 플러그인 plugin.json 한 곳에서 관리한다(scripts → 스킬 → skills → 플러그인 루트). 단독 실행이면 package.json.
const VERSION = (() => {
  for (const p of [path.join(HERE, "..", "..", "..", ".claude-plugin", "plugin.json"), path.join(HERE, "package.json")]) {
    try { return JSON.parse(readFileSync(p, "utf8")).version; } catch {}
  }
  return "0.0.0";
})();
// Lighthouse 13 은 Node 22.19 이상이 필요하다.
{
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 19)) {
    console.error(`Node ${process.versions.node} 에서는 실행할 수 없습니다. Node 22.19 이상으로 올린 뒤 다시 실행하세요.`);
    process.exit(1);
  }
}
const exec = promisify(execFile);
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ---------- 인자 ----------
// Lighthouse 는 기본 데스크톱 프리셋(CPU 1배). 모바일 프리셋은 CPU 4배 감속 + 느린 4G 모의라 점수 변동이 크다.
const opts = { url: null, out: process.cwd(), desktop: true, lighthouse: true, pdf: true, author: "", tlsRetry: false, pageType: null, detect: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opts.out = path.resolve(argv[++i]);
  else if (a === "--author") opts.author = argv[++i] || "";
  else if (a === "--mobile") opts.desktop = false;
  else if (a === "--desktop") opts.desktop = true;
  else if (a === "--skip-lighthouse") opts.lighthouse = false;
  else if (a === "--no-pdf") opts.pdf = false;
  else if (a === "--page-type") opts.pageType = argv[++i] === "home" ? "home" : "content";
  else if (a === "--detect") opts.detect = true;
  else if (a === "--tls-retry") opts.tlsRetry = true; // 내부용: 시스템 인증서 저장소로 재실행된 프로세스 표시
  else if (!a.startsWith("--")) opts.url = a;
}
if (!opts.url) {
  console.error("사용법: node audit.mjs <url> [--detect] [--page-type home|content] [--out <dir>] [--author <작성자>] [--mobile] [--skip-lighthouse] [--no-pdf]");
  process.exit(1);
}
if (!/^https?:\/\//i.test(opts.url)) opts.url = "https://" + opts.url;

// ---------- 공통 유틸 ----------
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA || "";
  return (
    [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].find((p) => p && existsSync(p)) || null
  );
}

// 리다이렉트를 직접 따라가며 홉 수를 기록한다 (fetch 의 자동 follow 는 체인을 숨긴다).
async function fetchFollow(url, { ua = BROWSER_UA, maxHops = 10, timeout = 20000 } = {}) {
  const hops = [];
  let current = url;
  for (let i = 0; i <= maxHops; i++) {
    let res;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeout),
        headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,text/plain,*/*;q=0.8", "accept-language": "ko,en;q=0.8" },
      });
    } catch (e) {
      return { ok: false, status: 0, error: e.cause?.message || e.message, url: current, hops, text: "", headers: {} };
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      hops.push({ url: current, status: res.status });
      current = new URL(loc, current).href;
      continue;
    }
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, url: current, headers: Object.fromEntries(res.headers), text, hops };
  }
  return { ok: false, status: 0, error: "리다이렉트 10회 초과", url: current, hops, text: "", headers: {} };
}

// Node 에 내장된 공개 루트 저장소만으로 TLS 체인을 검증한다 (--use-system-ca 와 무관하게 서버가 보낸 체인 자체를 평가).
// 검증을 끄지 않고 실패 코드만 받아 기록한다.
function tlsProbe(hostname, port = 443) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: hostname, port, servername: hostname, ca: tls.rootCertificates, rejectUnauthorized: true, timeout: 10000 }, () => {
      const c = s.getPeerCertificate();
      resolve({ ok: true, issuer: c.issuer?.O || c.issuer?.CN || "", validTo: c.valid_to || "" });
      s.end();
    });
    s.on("error", (e) => resolve({ ok: false, code: e.code || "", message: e.message }));
    s.on("timeout", () => { s.destroy(); resolve({ ok: false, code: "TIMEOUT", message: "TLS 연결 시간 초과" }); });
  });
}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const pad = (n) => String(n).padStart(2, "0");
// 리포트 · 파일명과 같은 로컬 시각(오프셋 포함)으로 기록한다.
const localIso = (d) => {
  const tz = -d.getTimezoneOffset(), a = Math.abs(tz);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
const stripSlash = (u) => u.replace(/\/$/, "").replace(/^http:/, "https:").toLowerCase();
const grade = (v, pass, warn) => (v >= pass ? "pass" : v >= warn ? "warn" : "fail");
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const shortList = (list, n = 3) => {
  const arr = [...new Set(list)];
  return arr.slice(0, n).map((s) => `“${s}”`).join(", ") + (arr.length > n ? ` 외 ${arr.length - n}개` : "");
};

// ponytail: 한글은 띄어쓰기 단위가 불규칙해 2글자 ≈ 1어절로 근사한다. 정밀 측정이 필요하면 형태소 분석기로 교체.
function wordCount(text) {
  const latin = (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
  const cjk = (text.match(/[\u3131-\uD79D\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length;
  return latin + Math.round(cjk / 2);
}
const sentences = (text) => norm(text).split(/(?<=[.!?。])\s+/).filter((s) => s.trim().length > 1);

// ---------- robots.txt ----------
function parseRobots(text) {
  const groups = [], sitemaps = [];
  let cur = null, lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if ((key === "allow" || key === "disallow") && cur && val) cur.rules.push({ allow: key === "allow", path: val });
      else if (key === "sitemap") sitemaps.push(val);
    }
  }
  return { groups, sitemaps };
}
function matchPath(pattern, pathname) {
  const body = pattern.endsWith("$") ? pattern.slice(0, -1) : pattern;
  const re = body.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + re + (pattern.endsWith("$") ? "$" : "")).test(pathname);
}
// Google 방식: 토큰이 정확히 일치하는 그룹 → 없으면 '*' 그룹. 가장 긴 규칙이 이기고 길이가 같으면 Allow 우선.
function robotsAllows(robots, token, pathname) {
  const t = token.toLowerCase();
  const own = robots.groups.find((g) => g.agents.includes(t));
  const g = own || robots.groups.find((g) => g.agents.includes("*"));
  if (!g) return { allowed: true, rule: "규칙 없음(전체 허용)" };
  let best = null;
  for (const r of g.rules) {
    if (!matchPath(r.path, pathname)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  const scope = own ? `User-agent: ${token}` : "User-agent: *";
  return { allowed: best ? best.allow : true, rule: best ? `${scope}, ${best.allow ? "Allow" : "Disallow"}: ${best.path}` : `${scope}, 일치 규칙 없음` };
}

const AI_BOTS = [
  { token: "Googlebot", vendor: "Google", role: "검색 · AI 오버뷰", citation: true },
  { token: "Bingbot", vendor: "Microsoft", role: "검색 · Copilot", citation: true },
  { token: "OAI-SearchBot", vendor: "OpenAI", role: "검색 · 인용 (ChatGPT 검색)", citation: true, probeUa: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot" },
  { token: "ChatGPT-User", vendor: "OpenAI", role: "사용자 요청 시 방문", citation: true },
  { token: "GPTBot", vendor: "OpenAI", role: "모델 학습", citation: false, probeUa: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot" },
  { token: "Claude-SearchBot", vendor: "Anthropic", role: "검색 · 인용", citation: true },
  { token: "Claude-User", vendor: "Anthropic", role: "사용자 요청 시 방문", citation: true },
  { token: "ClaudeBot", vendor: "Anthropic", role: "모델 학습", citation: false, probeUa: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { token: "PerplexityBot", vendor: "Perplexity", role: "검색 · 인용", citation: true, probeUa: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { token: "Perplexity-User", vendor: "Perplexity", role: "사용자 요청 시 방문", citation: true },
  { token: "DuckAssistBot", vendor: "DuckDuckGo", role: "검색 · 인용", citation: true },
  { token: "Google-Extended", vendor: "Google", role: "Gemini 학습 · 그라운딩 제어 토큰", citation: false },
  { token: "Applebot-Extended", vendor: "Apple", role: "학습 제어 토큰", citation: false },
  { token: "Bytespider", vendor: "ByteDance", role: "모델 학습", citation: false },
  { token: "CCBot", vendor: "Common Crawl", role: "학습 데이터셋", citation: false },
  { token: "meta-externalagent", vendor: "Meta", role: "모델 학습", citation: false },
  { token: "Amazonbot", vendor: "Amazon", role: "검색 · Alexa", citation: false },
];

// ---------- 메인 ----------
const startedAt = new Date();
const chromePath = findChrome();
const notes = [];
if (!chromePath) notes.push("Chrome 을 찾지 못해 Lighthouse · 렌더링 비교 · PDF 를 건너뛰었습니다. CHROME_PATH 환경변수로 chrome.exe 경로를 지정하세요.");

console.error(`▶ 점검 시작: ${opts.url}`);
const page = await fetchFollow(opts.url);
if (page.status === 0) {
  // 인증서 체인 문제면 OS 인증서 저장소(검증 유지)로 한 번 재실행한다. 체인 결함 자체는 아래 tls-chain 항목이 기록한다.
  if (/certificate|CERT_|TLS|SSL/i.test(page.error || "") && !process.execArgv.includes("--use-system-ca")) {
    console.error(`! TLS 검증 실패(${page.error}). 시스템 인증서 저장소(--use-system-ca)로 다시 시도합니다.`);
    const r = spawnSync(process.execPath, ["--use-system-ca", ...process.argv.slice(1), "--tls-retry"], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  console.error(`페이지를 가져올 수 없습니다: ${page.error}`);
  process.exit(2);
}
if (opts.tlsRetry) notes.push("서버 인증서 체인이 불완전해 일반 크롤러 방식의 첫 접속이 실패했습니다. 이 점검은 운영체제 인증서 저장소로 다시 접속해 진행했습니다. 상세는 기술 기본 · 페이지 경험 섹션의 ‘TLS 인증서 체인 검증’ 항목을 보세요.");
const finalUrl = new URL(page.url);
const origin = finalUrl.origin;
const host = finalUrl.hostname.replace(/^www\./, "");
const html = page.text || "";
const $ = load(html);

// ---------- robots.txt · 사이트맵 (페이지 유형 판별에도 쓴다) ----------
const robotsRes = await fetchFollow(origin + "/robots.txt");
const robotsIsText = robotsRes.ok && !/^\s*<(!doctype|html)/i.test(robotsRes.text);
const robots = robotsIsText ? parseRobots(robotsRes.text) : { groups: [], sitemaps: [] };
const sitemapUrl = robots.sitemaps[0] || origin + "/sitemap.xml";
const sitemapRes = await fetchFollow(sitemapUrl);
const sitemapXml = sitemapRes.ok && /<(urlset|sitemapindex)[\s>]/i.test(sitemapRes.text || "") ? sitemapRes.text : "";

// ---------- 페이지 유형 판별 ----------
// home: 메인 · 소개 페이지, content: 콘텐츠(글) 페이지. 확실하지 않으면 confident=false 를 돌려주고, SKILL 이 사용자에게 묻는다.
// 앱 · 로그인 화면은 따로 구분하지 않는다(측정된 그대로 채점).
async function detectPageType() {
  if (/^\/(index\.(html?|php|jsp|aspx?))?$/i.test(finalUrl.pathname)) return { type: "home", confident: true, reasons: ["최종 주소가 사이트 루트(/)"] };
  const reasons = [];
  const types = [];
  const collect = (n) => { if (Array.isArray(n)) n.forEach(collect); else if (n && typeof n === "object") { if (n["@type"]) types.push([].concat(n["@type"]).join("/")); Object.values(n).forEach(collect); } };
  $('script[type="application/ld+json"]').each((_, e) => { try { collect(JSON.parse(($(e).html() || "").trim())); } catch {} });
  if (types.some((t) => /Article|BlogPosting|NewsArticle|Report/.test(t))) reasons.push("Article 계열 스키마");
  if (/article/i.test($('meta[property="og:type"]').attr("content") || "")) reasons.push("og:type article");
  if (/\/(blog|news|posts?|articles?|insights?|guides?|columns?|magazine|stor(y|ies)|notice|board)(\/|$)|\/20\d\d\/\d{1,2}\//i.test(finalUrl.pathname)) reasons.push("글 주소 패턴");
  // 이름에 post · blog · news 가 들어간 하위 사이트맵(최대 3개)에 이 주소가 있으면 글로 본다.
  if (/<sitemapindex/i.test(sitemapXml)) {
    const key = (u) => { try { return decodeURI(new URL(u).href).replace(/\/$/, "").toLowerCase(); } catch { return String(u).toLowerCase(); } };
    const me = key(page.url);
    const subs = [...sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).filter((u) => /(post|blog|news|article|insight|column|magazine)[^/]*\.xml/i.test(u)).slice(0, 3);
    for (const u of subs) {
      const r = await fetchFollow(u, { timeout: 15000 });
      if ([...(r.text || "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].some((m) => key(m[1]) === me)) { reasons.push(`글 사이트맵(${u.split("/").pop()})에 포함`); break; }
    }
  }
  return reasons.length
    ? { type: "content", confident: true, reasons }
    : { type: null, confident: false, reasons: ["루트 주소가 아니고, Article 스키마 · og:type article · 글 주소 패턴 · 글 사이트맵 중 어느 신호도 없음"] };
}
const detected = await detectPageType();
if (opts.detect) {
  console.log(JSON.stringify({ url: page.url, ...detected }, null, 2));
  process.exit(0);
}
const pageType = opts.pageType || detected.type || "content";
const HOME = pageType === "home";
if (!opts.pageType && !detected.confident) notes.push("페이지 유형을 자동으로 판별하지 못해 콘텐츠(글) 페이지 기준으로 채점했습니다.");

let browser = null;
if (chromePath) {
  browser = await puppeteer
    .launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] })
    .catch((e) => (notes.push(`Chrome 실행 실패: ${e.message}`), null));
}

async function renderedText(url) {
  if (!browser) return { error: "Chrome 없음" };
  const p = await browser.newPage();
  try {
    await p.setUserAgent(BROWSER_UA);
    await p.goto(url, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }));
    const text = await p.evaluate(() => document.body?.innerText || "");
    return { text: norm(text) };
  } catch (e) {
    return { error: e.message };
  } finally {
    await p.close().catch(() => {});
  }
}

async function runLighthouse(url) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "lh-"));
  const outPath = path.join(tmp, "lh.json");
  const cli = path.join(HERE, "node_modules", "lighthouse", "cli", "index.js");
  const args = [cli, url, "--output=json", `--output-path=${outPath}`, "--quiet", "--locale=ko",
    "--only-categories=performance,accessibility,best-practices,seo", "--chrome-flags=--headless=new --no-sandbox --disable-gpu"];
  if (opts.desktop) args.push("--preset=desktop");
  try {
    await exec(process.execPath, args, { env: { ...process.env, CHROME_PATH: chromePath }, timeout: 240000, maxBuffer: 64e6 });
    const lhr = JSON.parse(await readFile(outPath, "utf8"));
    const a = lhr.audits;
    const num = (id) => a[id]?.numericValue ?? null;
    const failingSeo = (lhr.categories.seo?.auditRefs || [])
      .map((r) => a[r.id]).filter((x) => x && x.score !== null && x.score < 1 && x.scoreDisplayMode === "binary")
      .map((x) => ({ id: x.id, title: x.title }));
    return {
      version: lhr.lighthouseVersion, formFactor: lhr.configSettings.formFactor,
      scores: Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, v.score == null ? null : Math.round(v.score * 100)])),
      metrics: { lcp: num("largest-contentful-paint"), cls: num("cumulative-layout-shift"), tbt: num("total-blocking-time"), fcp: num("first-contentful-paint"), si: num("speed-index"), tti: num("interactive") },
      failingSeo,
    };
  } catch (e) {
    return { error: (e.stderr || e.message || "").toString().trim().split("\n").slice(-3).join(" ") };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function probeBots() {
  const out = {};
  await Promise.all(AI_BOTS.filter((b) => b.probeUa).map(async (b) => {
    let r = await fetchFollow(page.url, { ua: b.probeUa, timeout: 15000 });
    // 5xx · 연결 실패는 일시적일 수 있어 2초 뒤 한 번 더 시도한다. 403 · 429 는 명시적 차단이라 그대로 둔다.
    if (r.status === 0 || r.status >= 500) {
      await new Promise((ok) => setTimeout(ok, 2000));
      r = await fetchFollow(page.url, { ua: b.probeUa, timeout: 15000 });
    }
    out[b.token] = r.status;
  }));
  return out;
}

console.error("▶ robots.txt · sitemap · llms.txt · AI 봇 응답 · 렌더링 비교 수집 중…");
const [llmsRes, aiTxtRes, probes, rendered, tlsRes] = await Promise.all([
  fetchFollow(origin + "/llms.txt"),
  fetchFollow(origin + "/ai.txt"),
  probeBots(),
  renderedText(page.url),
  finalUrl.protocol === "https:" ? tlsProbe(finalUrl.hostname, Number(finalUrl.port) || 443) : Promise.resolve(null),
]);
// Lighthouse 는 CPU 를 나눠 쓰면 TBT 가 부풀어 점수가 크게 떨어지므로 다른 수집이 끝난 뒤 단독으로 돌린다.
console.error(`▶ Lighthouse (${opts.desktop ? "데스크톱" : "모바일"}) 측정 중…`);
const lh = opts.lighthouse && chromePath ? await runLighthouse(page.url) : { skipped: true, reason: opts.lighthouse ? "Chrome 없음" : "--skip-lighthouse" };
// ---------- HTML 추출 ----------
const headerText = $("head title").map((_, e) => norm($(e).text())).get();
const title = headerText[0] || "";
const descs = $('meta[name="description"]').map((_, e) => norm($(e).attr("content"))).get();
const canonicals = $('link[rel="canonical"]').map((_, e) => $(e).attr("href")).get().filter(Boolean);
const robotsMeta = $('meta[name="robots"], meta[name="googlebot"]').map((_, e) => norm($(e).attr("content")).toLowerCase()).get().join(", ");
const xRobots = (page.headers["x-robots-tag"] || "").toLowerCase();
const robotsDirectives = `${robotsMeta} ${xRobots}`;
const og = (p) => norm($(`meta[property="${p}"]`).attr("content"));
const htmlLang = $("html").attr("lang") || "";
const viewport = $('meta[name="viewport"]').attr("content") || "";
const hreflangs = $('link[rel="alternate"][hreflang]').map((_, e) => ({ lang: $(e).attr("hreflang"), href: $(e).attr("href") })).get();

const allHeadings = $("h1,h2,h3,h4,h5,h6").map((_, e) => ({ level: +e.tagName[1], text: norm($(e).text()) })).get();
const h1s = allHeadings.filter((h) => h.level === 1);

const mainEl = $("main, article, [role=main]").first();
const $content = mainEl.length ? mainEl : (() => { const b = $("body").clone(); b.find("nav, header, footer, aside, script, style, noscript, template, svg, form").remove(); return b; })();
const contentText = norm($content.text());
const words = wordCount(contentText);
// 상용구 소제목(함께 읽기 · 참고 자료 등)은 본문 구조 평가에서 뺀다.
const BOILER_H = /^(함께 읽기|참고 자료|참고 문헌|관련 용어|관련 글|관련 콘텐츠|목차|공유하기|댓글|태그|이 페이지|Table of Contents|References|Related( articles| posts)?|See also|Share|Comments|Tags)$/i;
const blocks = $content.find("h1,h2,h3,h4,h5,h6,p,ul,ol,table").toArray()
  .map((e) => ({ tag: e.tagName.toLowerCase(), text: norm($(e).text()) }))
  .filter((b) => !(/^h[1-6]$/.test(b.tag) && BOILER_H.test(b.text)));
const contentHeadings = blocks.filter((b) => /^h[23]$/.test(b.tag) && b.text);
const lists = $content.find("ul, ol").length, tables = $content.find("table").length;

const imgs = $("img").toArray();
const imgsWithAlt = imgs.filter((e) => typeof $(e).attr("alt") === "string").length;

const anchors = $("a[href]").toArray().map((e) => ({ href: $(e).attr("href"), text: norm($(e).text()) }));
const toAbs = (h) => { try { return new URL(h, page.url); } catch { return null; } };
const internal = anchors.filter((a) => { const u = toAbs(a.href); return u && /^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, "") === host; });
const genericAnchor = /^(여기|이곳|더보기|더 보기|클릭|클릭하세요|자세히|자세히 보기|바로가기|링크|here|click here|read more|more|learn more|link)$/i;
const genericCount = internal.filter((a) => genericAnchor.test(a.text)).length;
const contentExternalHosts = new Set(
  $content.find("a[href]").toArray().map((e) => toAbs($(e).attr("href"))).filter((u) => u && /^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, "") !== host).map((u) => u.hostname),
);

// JSON-LD
const ldBlocks = $('script[type="application/ld+json"]').map((_, e) => $(e).html() || "").get();
const ldNodes = [], ldErrors = [];
const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n["@type"]) ldNodes.push(n); Object.values(n).forEach(walk); } };
for (const raw of ldBlocks) { try { walk(JSON.parse(raw.trim())); } catch (e) { ldErrors.push(e.message); } }
const typeOf = (n) => [].concat(n["@type"]).join("/");
const ldTypes = [...new Set(ldNodes.map(typeOf))];
const CONTENT_TYPES = /Article|BlogPosting|WebPage|AboutPage|ContactPage|CollectionPage|FAQPage|HowTo|QAPage|Product|Service|Event|Recipe|Course|SoftwareApplication|ItemList|JobPosting|LocalBusiness|Organization|WebSite|BreadcrumbList/;
const ENTITY_TYPES = /Organization|Person|LocalBusiness|Corporation|Brand|WebSite/;
const entityNodes = ldNodes.filter((n) => ENTITY_TYPES.test(typeOf(n)));
const entityWithSameAs = entityNodes.filter((n) => n.sameAs && [].concat(n.sameAs).length);
const articleNode = ldNodes.find((n) => /Article|BlogPosting|WebPage/.test(typeOf(n)) && (n.headline || n.name));
const microdata = $("[itemscope], [typeof]").length;

// 저자 · 날짜
const nameOf = (v) => (typeof v === "string" ? v : Array.isArray(v) ? nameOf(v[0]) : v?.name) || "";
const authorName = norm(
  nameOf(ldNodes.find((n) => n.author)?.author) || $('meta[name="author"]').attr("content") ||
  $('[rel="author"], [itemprop="author"], .author-name, .byline, .author, [class*="byline"], [class*="author"]').first().text(),
);
const dateCands = [
  ...ldNodes.flatMap((n) => [n.dateModified, n.datePublished]),
  og("article:modified_time"), og("article:published_time"), og("og:updated_time"),
  $('meta[name="date"], meta[name="last-modified"], meta[itemprop="dateModified"], meta[itemprop="datePublished"]').attr("content"),
  $("time[datetime]").first().attr("datetime"),
].filter(Boolean).map((d) => new Date(d)).filter((d) => !isNaN(d));
const latestDate = dateCands.length ? new Date(Math.max(...dateCands)) : null;
const monthsAgo = latestDate ? (startedAt - latestDate) / (30.44 * 24 * 3600 * 1000) : null;

// 본문 신호
const sents = blocks.filter((b) => /^(p|ul|ol|table)$/.test(b.tag)).flatMap((b) => sentences(b.text));
const sourceRe = /(에\s*따르면|에\s*의하면|조사|연구|보고서|발표|출처|자료|통계|according to|study|survey|report|research|source)/i;
const yearParenRe = /\((?:[^()]{0,40},\s*)?(?:19|20)\d{2}\)/;
const numericSents = sents.filter((s) => /\d/.test(s)).length;
const sourcedStats = sents.filter((s) => /\d/.test(s) && (sourceRe.test(s) || yearParenRe.test(s))).length;
const quotes = $content.find("blockquote, q").length + (contentText.match(/[“"][^”"]{15,}[”"]/g) || []).length;
// 정의 문장: "X란 ~이다" / "X(English)는 ~입니다" / "X is a …" / "refers to"
const DEF_END = "(이다|입니다|을 말한다|를 말한다|을 말합니다|를 말합니다|을 의미한다|를 의미한다|을 의미합니다|를 의미합니다|을 뜻한다|를 뜻한다|을 뜻합니다|를 뜻합니다|을 가리킨다|를 가리킨다|을 가리킵니다|를 가리킵니다)";
const definitionRes = [
  new RegExp(`(이란|란|라는 것은|라고 하는 것은)\\s[^.!?]{3,200}${DEF_END}`),
  new RegExp(`^\\S{1,40}\\([A-Za-z][^)]{2,80}\\)(는|은)\\s[^.!?]{3,200}${DEF_END}`),
  /^[A-Z][\w\s()\-–]{1,60}\b(is|are) (a|an)\b/,
  /\brefers to\b|\bis defined as\b|\bstands for\b/i,
];
const definitionSents = sents.filter((s) => definitionRes.some((re) => re.test(s)));
const definitions = definitionSents.length;
// 예시는 자르지 않고, 조건에 맞는 문장 중 가장 짧은 것을 통째로 쓴다.
const sourcedExample = sents.filter((s) => /\d/.test(s) && (sourceRe.test(s) || yearParenRe.test(s))).sort((a, b) => a.length - b.length)[0];
// 한글에는 \b 단어 경계가 동작하지 않으므로 뒤따르는 문자를 lookahead 로 제한한다.
const Q_KO = /\?|^(무엇|어떻게|왜|언제|어디|누가|얼마|어떤|몇|뭐|무슨)|(이란|란|는 무엇|은 무엇|방법|방식|이유|차이|비교|관계|종류|장단점|정의|뜻|의미|실수|하는 법|해야 할까|할까|일까|인가)(?=$|[\s?:.,)\]\-–])/;
const Q_EN = /\b(how|what|why|when|where|which|who|can|does|do|is|are|should|vs\.?)\b/i;
const questionHeadings = contentHeadings.filter((h) => Q_KO.test(h.text) || Q_EN.test(h.text));
const answered = [], unanswered = [];
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (!/^h[23]$/.test(b.tag) || !b.text) continue;
  const next = blocks[i + 1];
  if (!next || /^h[1-6]$/.test(next.tag)) { unanswered.push(b.text); continue; }
  if (next.tag !== "p") { answered.push(b.text); continue; } // 리스트·표가 바로 오면 구조화된 답으로 인정
  const n = sentences(next.text).length, len = next.text.length;
  (n >= 1 && n <= 4 && len >= 40 && len <= 700 ? answered : unanswered).push(b.text);
}
const firstH2Idx = blocks.findIndex((b) => b.tag === "h2");
const introChars = (firstH2Idx < 0 ? [] : blocks.slice(0, firstH2Idx)).filter((b) => b.tag === "p").reduce((a, b) => a + b.text.length, 0);
const headCut = Math.max(1, Math.floor(blocks.length * 0.25));
const summaryRe = /(핵심\s*요약|요약|한눈에|한 눈에|TL;?DR|목차|Table of Contents|Key Takeaways|Summary|Overview|개요|이 글의 핵심)/i;
const hasSummary = blocks.slice(0, headCut).some((b) => summaryRe.test(b.text.slice(0, 60))) || $content.find('nav.toc, .toc, #toc, [class*="table-of-contents"], [class*="toc"]').length > 0 || $content.find('a[href^="#"]').length >= 3;

// llms.txt
const llmsOk = llmsRes.ok && !/^\s*<(!doctype|html)/i.test(llmsRes.text) && llmsRes.text.trim().length > 0;
const llmsLines = llmsOk ? llmsRes.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
const llmsFormat = llmsOk ? { h1: /^#\s+\S/.test(llmsLines[0] || ""), quote: llmsLines.some((l) => /^>\s*\S/.test(l)), links: llmsLines.filter((l) => /^-\s*\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(l)).length } : null;
const aiTxtOk = aiTxtRes.ok && !/^\s*<(!doctype|html)/i.test(aiTxtRes.text) && aiTxtRes.text.trim().length > 0;

// AI 봇 표
const bots = AI_BOTS.map((b) => {
  const v = robotsAllows(robots, b.token, finalUrl.pathname);
  return { ...b, allowed: v.allowed, rule: v.rule, probe: probes[b.token] ?? null };
});
const citationBots = bots.filter((b) => b.citation);
const blockedCitation = citationBots.filter((b) => !b.allowed);
const blockedTraining = bots.filter((b) => !b.citation && !b.allowed);
const probeBlocked = bots.filter((b) => b.probe != null && !(b.probe >= 200 && b.probe < 400));

// ---------- 체크 ----------
const S = {
  crawl: ["AI 크롤러 접근", "GEO"],
  schema: ["구조화 데이터", "AEO"],
  answer: HOME ? ["핵심 소개 문단", "AEO"] : ["즉답 문단", "AEO"],
  evidence: HOME ? ["운영 주체 · 신뢰 정보", "GEO"] : ["출처 · 수치 · 갱신일", "GEO"],
  meta: ["제목 · 메타 · 표준 URL", "SEO"],
  tech: ["기술 기본 · 페이지 경험", "SEO"],
};
const checks = [];
// 보고서 "권장 기준" 칸. 아래 판정 로직과 reference/checks.md 의 통과 기준을 짧게 옮긴 것.
const CRITERIA = {
  "http-status": "HTTP 200",
  noindex: "noindex · nosnippet 없음",
  "robots-ai": "검색 · 인용 봇 모두 허용",
  "bot-probe": "403 · 429 차단 없음",
  ssr: "렌더링 대비 70% 이상",
  "llms-txt": "H1, 요약, 링크 목록",
  "ai-txt": "선택 사항",
  "ld-present": "JSON-LD, 파싱 오류 없음",
  "ld-valid": "schema.org 와 @type",
  "ld-content-type": "Article, WebPage 등",
  "ld-entity": "Organization + sameAs",
  "ld-match": "headline = 제목 · H1",
  "faq-note": "점수 미반영",
  "question-headings": "30% 이상",
  "direct-answer": "70% 이상",
  "intro-length": "600자 이하",
  "lists-tables": "합계 3개 이상",
  "summary-top": "상단 요약 · 목차",
  definition: "1문장 이상",
  "sourced-stats": "3문장 이상",
  "outbound-sources": "2개 도메인 이상",
  quotes: "1개 이상",
  author: "바이라인 또는 schema author",
  dates: "게시일 · 갱신일",
  freshness: "12개월 이내",
  length: "1,500어절 이상",
  title: "1개, 15 ~ 60자",
  "meta-description": "1개, 50 ~ 160자",
  canonical: "절대 URL 자기 참조 1개",
  lang: "lang 속성",
  og: "3개 모두",
  viewport: "width=device-width",
  hreflang: "ISO 코드, 자기 참조, x-default",
  https: "HTTPS",
  "tls-chain": "공개 루트로 검증",
  redirects: "1회 이하",
  "robots-txt": "Sitemap 지시어 포함",
  sitemap: "XML 사이트맵",
  h1: "1개",
  "heading-order": "건너뛰기 · 빈 헤딩 0",
  "img-alt": "90% 이상",
  "internal-links": "5개 이상",
  cwv: "LCP 2.5s, CLS 0.1, TBT 200ms",
  // 메인 · 소개 페이지 전용
  "intro-sentence": "브랜드 · 서비스 정의 문장",
  "intro-snippet": "title · description 이 서비스 설명",
  "service-text": "원본 HTML 150어절 이상",
  "section-headings": "2개 이상",
  "trust-links": "4종 중 3종, 개인정보 필수",
  "business-info": "상호와 주소, 또는 사업자번호",
  "contact-info": "전화 또는 이메일",
  "org-details": "logo, url, 주소 · 연락처",
  "site-freshness": "12개월 이내",
};
// value: 표의 "측정값" 칸에 들어가는 짧은 값. detail: 진단 내용(긴 설명). fix: 개선 방법.
const add = (sec, id, title, weight, status, detail, fix = "", value = "", criterion = CRITERIA[id] || "") =>
  checks.push({ section: sec[0], category: sec[1], id, title, weight, status, score: { pass: 1, warn: 0.5, fail: 0 }[status] ?? null, value, criterion, detail, fix });

// 1. AI 크롤러 접근
add(S.crawl, "http-status", "페이지 응답 · 색인 가능", 3,
  page.status === 200 ? "pass" : "fail",
  page.hops.length ? `리다이렉트 ${page.hops.length}회 후 최종 URL 이 응답` : "입력 URL 이 바로 응답",
  page.status === 200 ? "" : "최종 URL 이 200 을 반환해야 검색 · AI 크롤러가 색인할 수 있습니다.",
  `HTTP ${page.status}`);
{
  const nz = $("[data-nosnippet]").length;
  add(S.crawl, "noindex", "noindex · 스니펫 제한 없음", 3,
    /noindex|none/.test(robotsDirectives) ? "fail" : /nosnippet|max-snippet:\s*0/.test(robotsDirectives) || nz ? "warn" : "pass",
    robotsDirectives.trim() || nz ? `robots 지시어: ${robotsDirectives.trim() || "없음"}${nz ? `, data-nosnippet 요소 ${nz}개` : ""}` : "noindex · nosnippet 지시어 없음",
    "Google 은 AI 오버뷰 · AI 모드 노출 조건을 ‘색인 + 스니펫 허용’으로 명시합니다. noindex, nosnippet, max-snippet:0, data-nosnippet 은 AI 노출도 제한합니다.",
    /noindex|none/.test(robotsDirectives) ? "noindex" : /nosnippet|max-snippet:\s*0/.test(robotsDirectives) ? "nosnippet" : nz ? `data-nosnippet ${nz}개` : "제한 없음");
}
add(S.crawl, "robots-ai", "검색 · 인용용 AI 봇 robots.txt 허용", 3,
  !robotsRes.ok ? "pass" : grade(citationBots.length - blockedCitation.length, citationBots.length, Math.ceil(citationBots.length / 2)),
  !robotsRes.ok ? "robots.txt 없음(전체 허용으로 해석)" : blockedCitation.length ? `차단: ${blockedCitation.map((b) => b.token).join(", ")}${blockedTraining.length ? `. 학습용 차단(감점 없음): ${blockedTraining.map((b) => b.token).join(", ")}` : ""}` : `검색 · 인용용 봇 ${citationBots.length}종 모두 허용${blockedTraining.length ? `. 학습용 차단(감점 없음): ${blockedTraining.map((b) => b.token).join(", ")}` : ""}`,
  blockedCitation.length ? "OAI-SearchBot, Claude-SearchBot, PerplexityBot 등 검색 · 인용용 봇을 차단하면 해당 AI 검색 결과에 나오지 않습니다. 학습 거부가 목적이면 GPTBot, ClaudeBot 같은 학습용 토큰만 Disallow 하세요." : "",
  !robotsRes.ok ? "robots.txt 없음" : `${citationBots.length - blockedCitation.length}/${citationBots.length} 허용`);
add(S.crawl, "bot-probe", "AI 봇 User-Agent 실제 요청 응답", 2,
  probeBlocked.length === 0 ? "pass" : probeBlocked.length < Object.keys(probes).length ? "warn" : "fail",
  Object.entries(probes).map(([k, v]) => `${k} HTTP ${v}`).join(", "),
  probeBlocked.length ? "robots.txt 와 별개로 WAF, 보안 플러그인, CDN 봇 차단 규칙이 AI 봇을 403 · 429 로 막고 있을 수 있습니다. 허용 목록에 추가하세요." : "",
  `${Object.keys(probes).length - probeBlocked.length}/${Object.keys(probes).length} 정상`);
{
  const rawLen = norm((() => { const b = $("body").clone(); b.find("script, style, noscript, template").remove(); return b.text(); })()).length;
  const ratio = rendered.text ? rawLen / Math.max(rendered.text.length, 1) : null;
  add(S.crawl, "ssr", "핵심 본문이 원본 HTML 에 포함 (JS 없이 읽힘)", 3,
    ratio == null ? "na" : ratio >= 0.7 ? "pass" : ratio >= 0.4 ? "warn" : "fail",
    ratio == null ? `렌더링 비교 불가 (${rendered.error || "Chrome 없음"}), 원본 HTML 텍스트 ${rawLen.toLocaleString()}자` : `원본 HTML 텍스트 ${rawLen.toLocaleString()}자, 렌더링 후 ${rendered.text.length.toLocaleString()}자`,
    ratio != null && ratio < 0.7 ? "대부분의 AI 크롤러는 JavaScript 를 실행하지 않습니다. SSR 또는 프리렌더링으로 본문 텍스트가 원본 HTML 에 들어가게 하세요." : "",
    ratio == null ? "비교 불가" : `${Math.round(ratio * 100)}%`);
}
add(S.crawl, "llms-txt", "llms.txt (비공식 제안)", 1,
  !llmsOk ? "fail" : llmsFormat.h1 && llmsFormat.quote && llmsFormat.links > 0 ? "pass" : "warn",
  !llmsOk ? `/llms.txt 없음 (HTTP ${llmsRes.status})` : `H1 ${llmsFormat.h1 ? "있음" : "없음"}, 요약(blockquote) ${llmsFormat.quote ? "있음" : "없음"}, 링크 ${llmsFormat.links}개`,
  !llmsOk ? "선택 사항입니다. 사이트 루트에 llms.txt(마크다운: H1 제목, ‘>’ 요약, ‘## 섹션’ 아래 ‘- [문서](URL): 설명’ 목록)를 두면 LLM 에이전트가 핵심 문서를 찾기 쉬워집니다." : llmsFormat.h1 && llmsFormat.quote ? "" : "llmstxt.org 형식에 맞춰 첫 줄 H1 과 blockquote 요약을 넣으세요.",
  !llmsOk ? "없음" : llmsFormat.h1 && llmsFormat.quote && llmsFormat.links > 0 ? "형식 충족" : "형식 미달");
add(S.crawl, "ai-txt", "ai.txt (실험적 제안)", 1, "info", aiTxtOk ? "/ai.txt 존재" : "/ai.txt 없음", "표준이 아니므로 점수에 넣지 않습니다. AI 사용 정책을 문장으로 밝히고 싶을 때만 추가하세요.", aiTxtOk ? "있음" : "없음");

// 2. 구조화 데이터
const PAGE_TYPES = /Article|BlogPosting|WebPage|AboutPage|ContactPage|CollectionPage|Product|Service|Event|Recipe|Course|SoftwareApplication|JobPosting|FAQPage|HowTo|QAPage/;
add(S.schema, "ld-present", "JSON-LD 구조화 데이터 존재 · 파싱 성공", 3,
  ldBlocks.length === 0 ? (microdata ? "warn" : "fail") : ldErrors.length ? "warn" : "pass",
  ldBlocks.length === 0 ? (microdata ? `JSON-LD 없음, Microdata/RDFa 요소 ${microdata}개` : "구조화 데이터 없음") : `타입: ${ldTypes.join(", ") || "없음"}${ldErrors.length ? `. 파싱 오류 ${ldErrors.length}건` : ""}`,
  ldBlocks.length === 0 ? "Google 권장 형식인 JSON-LD 로 페이지 유형(Article, WebPage 등)과 운영 주체(Organization)를 선언하세요." : ldErrors.length ? "JSON 문법 오류가 있는 블록은 전체가 무시됩니다. 리치 결과 테스트로 검증하세요." : "",
  ldBlocks.length ? `${ldBlocks.length}개 블록${ldErrors.length ? `, 오류 ${ldErrors.length}` : ""}` : microdata ? "Microdata 만" : "없음");
add(S.schema, "ld-valid", "@context · @type 유효", 2,
  ldNodes.length === 0 ? "na" : ldBlocks.every((b) => /schema\.org/i.test(b)) && ldNodes.every((n) => n["@type"]) ? "pass" : "warn",
  ldNodes.length === 0 ? "구조화 데이터 없음" : `노드 ${ldNodes.length}개`,
  "모든 블록에 \"@context\": \"https://schema.org\" 와 @type 을 넣으세요.",
  ldNodes.length ? `${ldBlocks.filter((b) => /schema\.org/i.test(b)).length}/${ldBlocks.length} 블록` : "없음");
{
  const pageTypes = ldTypes.filter((t) => PAGE_TYPES.test(t) || (HOME && /WebSite|Organization|Corporation|LocalBusiness/.test(t)));
  add(S.schema, "ld-content-type", HOME ? "사이트 · 운영 주체 스키마 (WebSite · Organization)" : "페이지 유형 스키마 (Article · WebPage 등)", 2,
    pageTypes.length ? "pass" : ldNodes.length ? "warn" : "fail",
    `선언된 타입: ${ldTypes.filter((t) => CONTENT_TYPES.test(t)).join(", ") || "없음"}`,
    HOME ? "메인 페이지에는 WebSite(name, url)와 Organization(name, url, logo, sameAs)을 선언하세요. 앱 서비스라면 SoftwareApplication 도 함께 쓸 수 있습니다." : "글이면 Article/BlogPosting(headline, author, datePublished, dateModified), 서비스 페이지면 WebPage/Service 를 선언하세요. FAQPage · HowTo 는 리치 결과가 축소되어 점수에 넣지 않습니다.",
    pageTypes.length ? pageTypes.join(", ") : "없음",
    HOME ? "WebSite, Organization 등" : CRITERIA["ld-content-type"]);
}
add(S.schema, "ld-entity", "운영 주체 엔티티 (Organization/Person + sameAs)", 2,
  entityWithSameAs.length ? "pass" : entityNodes.length ? "warn" : "fail",
  entityNodes.length ? `${[...new Set(entityNodes.map(typeOf))].join(", ")}` : "Organization · Person 스키마 없음",
  entityWithSameAs.length ? "" : "Organization(또는 Person)에 name, url, logo, sameAs(공식 SNS · 위키 등)를 넣어 AI 가 브랜드를 하나의 엔티티로 인식하게 하세요.",
  entityWithSameAs.length ? "sameAs 있음" : entityNodes.length ? "sameAs 없음" : "없음");
{
  const h1Text = (h1s[0]?.text || "").toLowerCase(), t = title.toLowerCase();
  const head = articleNode ? norm(articleNode.headline || articleNode.name).toLowerCase() : "";
  const faq = ldNodes.filter((n) => /Question/.test(typeOf(n)) && n.name);
  const faqInPage = faq.filter((q) => contentText.toLowerCase().includes(norm(q.name).toLowerCase().slice(0, 30))).length;
  const match = head ? h1Text.includes(head) || head.includes(h1Text) || t.includes(head) || head.includes(t.slice(0, 20)) : null;
  const st = match == null && !faq.length ? "na" : match === false || (faq.length && faqInPage < faq.length) ? "warn" : "pass";
  add(S.schema, "ld-match", "스키마 내용이 보이는 본문과 일치", 2, st,
    [head ? `headline “${head}” ${match ? "= 제목/H1" : "≠ 제목/H1"}` : "", faq.length ? `FAQ 질문 ${faq.length}개 중 본문에 보이는 것 ${faqInPage}개` : ""].filter(Boolean).join(". ") || "비교할 headline · FAQ 없음",
    "Google 은 구조화 데이터가 화면에 보이는 텍스트와 일치해야 한다고 명시합니다. 보이지 않는 내용은 마크업에서 제거하세요.",
    st === "na" ? "비교 대상 없음" : st === "warn" ? "불일치" : "일치");
  if (faq.length) add(S.schema, "faq-note", "FAQPage 스키마 사용 중", 1, "info", `Question ${faq.length}개`, "2023-08 이후 FAQ 리치 결과는 정부 · 의료 사이트로 제한되었습니다. 유지해도 무해하지만 노출 효과를 기대하지 마세요.", `${faq.length}개`);
}

const thin = words < 300;
if (!HOME) {
// 3. 즉답 문단
{
  const n = contentHeadings.length, q = questionHeadings.length, a = answered.length, total = answered.length + unanswered.length;
  add(S.answer, "question-headings", "사용자 질문형 소제목 (h2 · h3)", 2,
    n === 0 ? "fail" : grade(pct(q, n), 30, 1),
    n === 0 ? "본문 소제목 없음" : `소제목 ${n}개 중 질문 · 검색어 형태 ${q}개${q ? `. 예: ${shortList(questionHeadings.map((h) => h.text))}` : ""}`,
    "소제목을 사용자가 실제로 검색 · 질문하는 문장(“~란?”, “~하는 방법”, “~와 ~의 차이”)으로 쓰면 답변 엔진이 조각 단위로 발췌하기 쉬워집니다.",
    n ? `${q}/${n} (${pct(q, n)}%)` : "소제목 없음");
  add(S.answer, "direct-answer", "소제목 직후 2 ~ 3문장 즉답", 3,
    n === 0 ? "fail" : grade(pct(a, total), 70, 40),
    n === 0 ? "본문 소제목 없음" : `소제목 바로 아래에 1 ~ 4문장(40자 이상) 답 또는 리스트 · 표가 오는 것 ${a}개${unanswered.length ? `. 미충족 예: ${shortList(unanswered)}` : ""}`,
    "각 소제목 바로 아래 첫 문단에서 결론을 2 ~ 3문장으로 먼저 말하고, 근거와 상세는 그 뒤에 두세요. AI 는 소제목과 첫 문단을 하나의 조각으로 가져갑니다.",
    n ? `${a}/${total} (${pct(a, total)}%)` : "소제목 없음");
}
add(S.answer, "intro-length", "서론 길이 (첫 h2 이전)", 2,
  firstH2Idx < 0 ? (thin ? "na" : "warn") : introChars <= 600 ? "pass" : introChars <= 1200 ? "warn" : "fail",
  firstH2Idx < 0 ? "h2 가 없어 서론 구간을 나눌 수 없음" : `첫 h2 이전 본문 ${introChars.toLocaleString()}자`,
  "서론이 길면 답이 뒤로 밀립니다. 첫 h2 이전은 600자(약 3 ~ 4문장) 안에서 핵심 요약으로 끝내세요.",
  firstH2Idx < 0 ? "h2 없음" : `${introChars.toLocaleString()}자`);
add(S.answer, "lists-tables", "리스트 · 표로 구조화", 2,
  thin && lists + tables === 0 ? "warn" : grade(lists + tables, 3, 1),
  `본문 약 ${words.toLocaleString()}어절에 목록 ${lists}개, 표 ${tables}개`,
  "비교, 절차, 조건은 표와 목록으로 정리하세요. 인용 흡수 연구(2026)에서 리스트 밀도는 상위 25% 페이지가 하위보다 8.9배 높았습니다.",
  `목록 ${lists}, 표 ${tables}`);
add(S.answer, "summary-top", "상단 핵심 요약 · 목차", 1,
  hasSummary ? "pass" : thin ? "na" : "warn",
  hasSummary ? "요약 · 목차 요소 감지" : "상단 요약 · 목차 없음",
  "글 상단에 ‘핵심 요약’ 3 ~ 4문장 또는 목차를 두면 답변 엔진이 페이지 주제를 빨리 파악합니다.",
  hasSummary ? "있음" : "없음");
add(S.answer, "definition", "핵심 개념 정의 문장 (“X란 ~이다”)", 1,
  definitions ? "pass" : thin ? "na" : "warn",
  definitions ? `예: “${[...definitionSents].sort((a, b) => a.length - b.length)[0]}”` : "정의형 문장 없음",
  "주요 개념을 “X(영문)는 ~하는 것이다” 한 문장으로 정의하세요. 정의 문장은 인용 영향력이 가장 높은 요소(+57%)로 보고되었습니다.",
  `${definitions}문장`);

// 4. 출처 · 수치 · 갱신일
add(S.evidence, "sourced-stats", "출처 · 연도가 붙은 수치 문장", 3,
  grade(sourcedStats, 3, 1),
  `숫자가 있는 문장 ${numericSents}개 중 출처 표지(“~에 따르면”, “(출처, 연도)”)가 함께 있는 문장 ${sourcedStats}개${sourcedExample ? `. 예: “${sourcedExample}”` : ""}`,
  "주장에 숫자를 붙이고 같은 문장 안에 출처와 연도를 적으세요. 예: “W3Techs 에 따르면 2026년 3월 기준 전 세계 웹사이트의 43.5% 가 워드프레스를 사용합니다(W3Techs, 2026).”. GEO 논문에서 통계 추가는 가시성을 40% 이상 높였습니다.",
  `${sourcedStats}/${numericSents} 문장`);
add(S.evidence, "outbound-sources", "본문 외부 출처 링크", 2,
  grade(contentExternalHosts.size, 2, 1),
  contentExternalHosts.size ? `${[...contentExternalHosts].slice(0, 4).join(", ")}${contentExternalHosts.size > 4 ? " 외" : ""}` : "본문에 외부 링크 없음",
  "통계, 공식 문서, 논문 등 1차 출처로 링크하세요. 출처가 보이는 글이 AI 의 신뢰 평가에서 유리합니다.",
  `${contentExternalHosts.size}개 도메인`);
add(S.evidence, "quotes", "전문가 · 기관 직접 인용문", 1,
  quotes ? "pass" : thin ? "na" : "warn",
  quotes ? `blockquote · 따옴표 인용 ${quotes}개` : "blockquote · 따옴표 인용 없음",
  "전문가나 공식 문서의 발언을 큰따옴표로 인용하고 발언자를 명시하세요(GEO 논문 기준 주관적 인상 +37%).",
  `${quotes}개`);
add(S.evidence, "author", "저자 표기", 2,
  authorName ? "pass" : "fail",
  authorName ? `저자: ${authorName}` : "바이라인, meta author, schema author 모두 없음",
  "바이라인과 Article.author(Person: name, url, sameAs)로 누가 썼는지 밝히세요. E-E-A-T 의 기본 신호입니다.",
  authorName || "없음");
add(S.evidence, "dates", "게시일 · 갱신일 표기", 2,
  latestDate ? "pass" : "fail",
  latestDate ? "schema, meta, time 요소 기준 가장 최근 날짜" : "datePublished, dateModified, time[datetime] 없음",
  "Article.datePublished · dateModified 와 화면의 날짜를 함께 두세요. 갱신일이 보여야 AI 가 최신 자료로 판단합니다.",
  latestDate ? latestDate.toISOString().slice(0, 10) : "없음");
add(S.evidence, "freshness", "최근 12개월 내 갱신", 2,
  monthsAgo == null ? "na" : monthsAgo <= 12 ? "pass" : monthsAgo <= 24 ? "warn" : "fail",
  monthsAgo == null ? "날짜가 없어 판단 불가" : `마지막 갱신 후 ${Math.round(monthsAgo)}개월`,
  "통계, 연도, 정책이 바뀐 부분을 고치고 dateModified 를 갱신하세요.",
  monthsAgo == null ? "날짜 없음" : `${Math.round(monthsAgo)}개월 전`);
add(S.evidence, "length", "본문 분량", 1,
  grade(words, 1500, 500),
  `본문 약 ${words.toLocaleString()}어절(한글 2자를 1어절로 근사)`,
  "인용 흡수 연구(2026)에서 3,000단어 이상 긴 글의 영향력이 더 높았습니다. 다만 홈 · 서비스 페이지는 해당되지 않습니다.",
  `${words.toLocaleString()}어절`);
} else {
  // 메인 · 소개 페이지: 정보형 글에 맞춘 즉답 · 출처 항목 대신 소개 문단과 운영 주체 · 신뢰 정보를 본다.
  // 모두 원본 HTML(JavaScript 실행 전) 기준이다. 대부분의 AI 크롤러가 보는 것과 같다.
  const bodyText = norm((() => { const b = $("body").clone(); b.find("script, style, noscript, template").remove(); return b.text(); })());
  const orgNode = ldNodes.find((n) => /Organization|Corporation|LocalBusiness/.test(typeOf(n)));
  const brand = norm(orgNode?.name || og("og:site_name") || title.split(/\s+[|\-–—:·]\s+|\s*\|\s*/)[0] || host.split(".")[0]);
  const brandRe = brand ? new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : /$^/;
  const INTRO_WORD = /(기업|회사|서비스|플랫폼|솔루션|에이전시|스튜디오|전문|제공|개발|운영|구축|만듭니다|돕습니다|company|platform|service|solution|agency|studio|provides|helps|builds)/i;
  // 브랜드가 주어인 서술문(“반얀트리(Banyan Tree)는 … 브랜드입니다.”)은 업종 단어와 무관하게 소개 문장으로 본다.
  // 브랜드 전체 이름 또는 첫 단어(2자 이상)를 주어 후보로 쓴다.
  const brandTokens = [...new Set([brand, brand.split(/\s+/)[0]].filter((t) => t && t.length >= 2))].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const brandSubject = brandTokens.length ? new RegExp(`(${brandTokens.join("|")})(\\s?\\([^)]{1,40}\\))?\\s?(은|는|이|가)\\s`, "i") : /$^/;
  // 문장으로 끝나야 한다(메뉴 · 버튼 라벨 제외).
  const isIntro = (s) => s.length >= 20 && s.length <= 220 && /(다|요)[.!]?$|[.!?]$/.test(s) && (definitionRes.some((re) => re.test(s)) || (brandSubject.test(s) && /(입니다|이다|합니다|습니다|됩니다)[.!]?$/.test(s)) || ((brandRe.test(s) || /^(저희|우리|당사)/.test(s)) && INTRO_WORD.test(s)));
  // 본문 영역(메뉴 · 머리글 · 바닥글 제외)의 요소 단위로 문장을 뽑는다. 요소 안 글자는 띄어서 잇는다(.text() 는 공백 없이 붙인다).
  const spaced = (n) => (n.type === "text" ? n.data : n.type === "tag" ? (n.children || []).map(spaced).join(" ") : "");
  const blockTexts = $content.find("p, li, h1, h2, h3, h4, dd, figcaption, blockquote, td").toArray().map((e) => norm(spaced(e))).filter(Boolean);
  // 예시는 “~입니다 · ~이다”로 끝나는 정의형 문장을 먼저, 그다음 짧은 순.
  const introOrder = (a, b) => (/(입니다|이다)[.!]?$/.test(b) - /(입니다|이다)[.!]?$/.test(a)) || a.length - b.length;
  const bodyIntro = [...new Set(blockTexts.flatMap((t) => sentences(t)))].filter(isIntro).sort(introOrder);
  const metaIntro = [descs[0], og("og:description")].filter(Boolean).flatMap((t) => sentences(t)).filter(isIntro).sort(introOrder);

  // 3. 핵심 소개 문단
  add(S.answer, "intro-sentence", "회사 · 서비스 소개 문장", 3,
    bodyIntro.length ? "pass" : metaIntro.length ? "warn" : "fail",
    bodyIntro.length ? `예: “${bodyIntro[0]}”` : metaIntro.length ? `메타 설명에만 있음: “${metaIntro[0]}”` : `브랜드(${brand || "확인 불가"})가 무엇을 하는지 밝히는 문장을 원본 HTML 에서 찾지 못함`,
    bodyIntro.length ? "" : `첫 화면에 “${brand || "회사명"}는 ~하는 회사(서비스)입니다”처럼 무엇을 하는지 한두 문장으로 밝히는 텍스트를 원본 HTML 에 두세요. AI 답변은 이런 문장을 브랜드 설명으로 가져갑니다.`,
    bodyIntro.length ? "본문에 있음" : metaIntro.length ? "메타 설명에만" : "없음");
  {
    const DEFAULT_DESC = /create-react-app|Vite App|React App|Next\.js App|Nuxt|Web site created using|Welcome to|Default description/i;
    const titleOk = title.length >= 10 && title.toLowerCase() !== brand.toLowerCase();
    const descDefault = !!descs[0] && DEFAULT_DESC.test(descs[0]);
    const descOk = !!descs[0] && !descDefault && descs[0].length >= 40;
    add(S.answer, "intro-snippet", "검색 결과 문구가 서비스를 설명", 2,
      titleOk && descOk ? "pass" : titleOk || descOk ? "warn" : "fail",
      `title “${title || "없음"}”, description “${descs[0] || "없음"}”`,
      titleOk && descOk ? "" : `title 에 브랜드명과 함께 무엇을 하는 곳인지(예: “${brand || "브랜드"} | 핵심 서비스 한 줄”)를 쓰고, description 에 서비스를 설명하는 한두 문장을 쓰세요.${descDefault ? " 지금 description 은 프레임워크 기본 문구입니다." : ""}`,
      `title ${titleOk ? "적합" : "브랜드명만"}, description ${descOk ? "적합" : descDefault ? "기본 문구" : descs[0] ? "짧음" : "없음"}`);
  }
  {
    const n = wordCount(bodyText);
    add(S.answer, "service-text", "서비스 설명이 텍스트로 제공", 2,
      grade(n, 150, 50),
      "원본 HTML(JavaScript 실행 전)에 들어 있는 텍스트 기준",
      n >= 150 ? "" : "서비스와 사업 설명을 이미지나 스크립트가 아닌 텍스트로 두세요. Google 도 중요한 내용은 텍스트로 제공하라고 권장합니다.",
      `${n.toLocaleString()}어절`);
  }
  add(S.answer, "section-headings", "구역별 소제목 (h2 · h3)", 1,
    contentHeadings.length >= 2 ? "pass" : contentHeadings.length === 1 ? "warn" : "fail",
    contentHeadings.length ? `예: ${shortList(contentHeadings.map((h) => h.text))}` : "본문 소제목 없음",
    contentHeadings.length >= 2 ? "" : "사업 영역, 서비스, 사례처럼 구역마다 h2 소제목을 두면 AI 가 페이지 구성을 파악하기 쉽습니다.",
    `${contentHeadings.length}개`);

  // 4. 운영 주체 · 신뢰 정보
  {
    const LINKS = [["회사 소개", /회사\s*소개|기업\s*소개|about|company|introduc/i], ["문의 · 고객센터", /문의|contact|고객\s*센터|고객\s*지원|support|help|오시는\s*길/i], ["개인정보처리방침", /개인정보|privacy/i], ["이용약관", /약관|terms/i]];
    const has = LINKS.map(([label, re]) => [label, anchors.some((a) => re.test(a.text) || re.test(a.href))]);
    const found = has.filter(([, ok]) => ok).map(([l]) => l), missing = has.filter(([, ok]) => !ok).map(([l]) => l);
    const ok = found.length >= 3 && has[2][1];
    add(S.evidence, "trust-links", "회사 소개 · 문의 · 정책 링크", 3,
      ok ? "pass" : found.length ? "warn" : "fail",
      !found.length ? "회사 소개, 문의 · 고객센터, 개인정보처리방침, 이용약관 링크 모두 없음" : `있음: ${found.join(", ")}${missing.length ? `. 없음: ${missing.join(", ")}` : ""}`,
      ok ? "" : "머리글이나 바닥글에 회사 소개, 문의(고객센터), 개인정보처리방침, 이용약관 링크를 원본 HTML 로 두세요. 운영 주체를 확인할 수 있어야 AI 가 신뢰할 출처로 봅니다.",
      `${found.length}/4`);
  }
  {
    const bizNo = /\d{3}-\d{2}-\d{5}/.test(bodyText);
    const company = /(\(주\)|㈜|주식회사|유한회사|Inc\.|Co\.,?\s?Ltd|Corp\.?|LLC)/i.test(bodyText) || !!orgNode?.legalName;
    const address = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)\S*\s+\S+(시|군|구)\s+\S+(로|길|동|읍|면)/.test(bodyText) || !!orgNode?.address;
    const copyright = /©|ⓒ|copyright/i.test(bodyText);
    const got = [bizNo && "사업자등록번호", company && "상호", address && "주소", copyright && "저작권 표기"].filter(Boolean);
    const ok = bizNo || (company && address);
    add(S.evidence, "business-info", "상호 · 주소 · 사업자 정보", 2,
      ok ? "pass" : got.length ? "warn" : "fail",
      got.length ? `확인됨: ${got.join(", ")}` : "상호, 주소, 사업자등록번호, 저작권 표기 모두 없음",
      ok ? "" : "바닥글에 상호, 주소, 사업자등록번호를 텍스트로 표기하세요. 운영 주체를 확인하는 기본 신호입니다.",
      got.length ? got.join(", ") : "없음");
  }
  {
    const tel = anchors.some((a) => /^tel:/i.test(a.href)) || /(0\d{1,2}|1\d{3})[-.\s]\d{3,4}[-.\s]\d{4}|\b1[5-9]\d{2}-\d{4}\b/.test(bodyText) || !!(orgNode?.telephone || orgNode?.contactPoint);
    const mail = anchors.some((a) => /^mailto:/i.test(a.href)) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(bodyText) || !!orgNode?.email;
    const got = [tel && "전화", mail && "이메일"].filter(Boolean);
    add(S.evidence, "contact-info", "연락 수단 표기", 2,
      got.length ? "pass" : "fail",
      got.length ? "본문 텍스트, tel · mailto 링크, 연락처 스키마 기준" : "전화번호, 이메일, 연락처 스키마 모두 없음",
      got.length ? "" : "대표 전화나 이메일을 텍스트(또는 tel · mailto 링크)와 Organization.contactPoint 로 표기하세요.",
      got.length ? got.join(", ") : "없음");
  }
  {
    const has = { logo: !!orgNode?.logo, url: !!orgNode?.url, contact: !!(orgNode?.address || orgNode?.contactPoint || orgNode?.telephone || orgNode?.email) };
    const missing = [!has.logo && "logo", !has.url && "url", !has.contact && "주소 · 연락처"].filter(Boolean);
    add(S.evidence, "org-details", "Organization 스키마 상세", 2,
      !orgNode ? "fail" : missing.length ? "warn" : "pass",
      !orgNode ? "Organization 스키마 없음" : missing.length ? `없음: ${missing.join(", ")}` : "logo, url, 주소 · 연락처 모두 선언",
      !orgNode || missing.length ? "Organization 에 name, url, logo, address 또는 contactPoint 를 넣어 운영 주체 정보를 기계가 읽게 하세요." : "",
      !orgNode ? "없음" : `${3 - missing.length}/3`);
  }
  {
    const lastmods = [...sitemapXml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)].map((m) => new Date(m[1])).filter((d) => !isNaN(d));
    const latest = lastmods.length ? new Date(Math.max(...lastmods)) : null;
    const months = latest ? (startedAt - latest) / (30.44 * 24 * 3600 * 1000) : null;
    add(S.evidence, "site-freshness", "사이트 최근 갱신 (사이트맵 lastmod)", 1,
      months == null ? "na" : months <= 12 ? "pass" : months <= 24 ? "warn" : "fail",
      months == null ? "사이트맵 lastmod 가 없어 판단 불가" : `사이트맵의 가장 최근 lastmod 기준 ${Math.round(months)}개월 전`,
      months != null && months > 12 ? "콘텐츠가 바뀌면 사이트맵 lastmod 를 실제 수정일로 갱신하세요." : "",
      latest ? latest.toISOString().slice(0, 10) : "없음");
  }
}

// 5. 제목 · 메타 · 표준 URL
add(S.meta, "title", "title 태그", 3,
  !title ? "fail" : headerText.length > 1 ? "warn" : title.length >= 15 && title.length <= 60 ? "pass" : "warn",
  !title ? "title 없음" : `“${title}”${headerText.length > 1 ? `. title ${headerText.length}개 출력` : ""}`,
  "페이지마다 고유한 title 1개, 핵심 키워드를 앞에, 사이트명은 뒤에. 표시 폭 약 600px(한글 약 30자, 영문 약 60자)을 넘으면 잘립니다.",
  title ? `${title.length}자${headerText.length > 1 ? `, ${headerText.length}개` : ""}` : "없음");
add(S.meta, "meta-description", "meta description", 2,
  descs.length === 0 || !descs[0] ? "fail" : descs.length > 1 ? "warn" : descs[0].length >= 50 && descs[0].length <= 160 ? "pass" : "warn",
  descs[0] ? `“${descs[0]}”${descs.length > 1 ? `. ${descs.length}개 중복 출력` : ""}` : "meta description 없음",
  "페이지 내용을 50 ~ 160자로 요약한 고유 문장 1개. 순위 요인은 아니지만 스니펫과 클릭률에 영향합니다.",
  descs[0] ? `${descs[0].length}자${descs.length > 1 ? `, ${descs.length}개` : ""}` : "없음");
{
  const can = canonicals[0] ? toAbs(canonicals[0]) : null;
  const self = can && stripSlash(can.href) === stripSlash(page.url);
  add(S.meta, "canonical", "표준 URL (canonical)", 3,
    canonicals.length === 0 ? "fail" : canonicals.length > 1 ? "warn" : !/^https?:\/\//i.test(canonicals[0]) ? "warn" : self ? "pass" : "warn",
    canonicals.length === 0 ? "canonical 없음" : canonicals[0],
    "절대 URL 로 자기 자신을 가리키는 canonical 1개. https/www 변형, 사이트맵, 리다이렉트와 같은 URL 을 쓰세요.",
    canonicals.length === 0 ? "없음" : canonicals.length > 1 ? `${canonicals.length}개 충돌` : self ? "자기 참조" : "다른 URL");
}
add(S.meta, "lang", "html lang 속성", 1, htmlLang ? "pass" : "fail", htmlLang ? `<html lang="${htmlLang}">` : "lang 없음", "<html lang=\"ko\"> 처럼 문서 언어를 선언하세요.", htmlLang || "없음");
{
  const ogs = ["og:title", "og:description", "og:image"];
  add(S.meta, "og", "Open Graph (og:title · description · image)", 1,
    ogs.every((p) => og(p)) ? "pass" : og("og:title") ? "warn" : "fail",
    ogs.every((p) => !og(p)) ? "og:title, og:description, og:image 모두 없음" : `있음: ${ogs.filter((p) => og(p)).join(", ")}${ogs.some((p) => !og(p)) ? `. 없음: ${ogs.filter((p) => !og(p)).join(", ")}` : ""}`,
    "공유 카드와 AI 답변 카드에 쓰이는 og:title, og:description, og:image 를 채우세요.",
    `${ogs.filter((p) => og(p)).length}/3`);
}
add(S.meta, "viewport", "viewport (모바일 대응)", 1, /width=device-width/.test(viewport) ? "pass" : "fail", viewport || "viewport 없음", "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> 를 추가하세요.", /width=device-width/.test(viewport) ? "있음" : "없음");
if (hreflangs.length) {
  // 언어[-스크립트][-지역] 예: ko, en-GB, zh-Hans, zh-Hant-TW, es-419
  const codeOk = hreflangs.every((h) => /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i.test(h.lang));
  const selfRef = hreflangs.some((h) => { const u = toAbs(h.href); return u && stripSlash(u.href) === stripSlash(page.url); });
  const xdef = hreflangs.some((h) => h.lang.toLowerCase() === "x-default");
  add(S.meta, "hreflang", "hreflang 유효성", 1, codeOk && selfRef && xdef ? "pass" : codeOk && selfRef ? "warn" : "fail",
    `코드 ${codeOk ? "유효" : "오류"}, 자기 참조 ${selfRef ? "있음" : "없음"}, x-default ${xdef ? "있음" : "없음"}`,
    "ISO 639-1(+ISO 3166-1) 코드, 자기 자신을 포함한 상호 참조, x-default 를 갖추세요.",
    `${hreflangs.length}개`);
} else add(S.meta, "hreflang", "hreflang", 1, "na", "다국어 선언 없음(단일 언어 사이트면 정상)", "", "선언 없음");

// 6. 기술 기본 · 페이지 경험
add(S.tech, "https", "HTTPS", 3, finalUrl.protocol === "https:" ? "pass" : "fail",
  page.headers["strict-transport-security"] ? "HSTS 헤더 적용" : "HSTS 헤더 없음",
  finalUrl.protocol === "https:" ? "" : "모든 페이지를 HTTPS 로 제공하고 HTTP 는 301 로 보내세요.",
  finalUrl.protocol.replace(":", "").toUpperCase());
{
  const why = { UNABLE_TO_VERIFY_LEAF_SIGNATURE: ["중간 인증서 누락", "서버가 중간 인증서(intermediate)를 보내지 않아 공개 루트 저장소만으로는 검증 불가"], CERT_HAS_EXPIRED: ["만료", "인증서 만료"], ERR_TLS_CERT_ALTNAME_INVALID: ["도메인 불일치", "인증서 도메인 불일치"], DEPTH_ZERO_SELF_SIGNED_CERT: ["자체 서명", "자체 서명 인증서"], SELF_SIGNED_CERT_IN_CHAIN: ["자체 서명", "체인에 자체 서명 인증서 포함"], UNABLE_TO_GET_ISSUER_CERT_LOCALLY: ["발급자 불명", "발급자 인증서를 찾을 수 없음"] };
  const w = tlsRes && !tlsRes.ok ? why[tlsRes.code] || ["검증 실패", tlsRes.message] : null;
  add(S.tech, "tls-chain", "TLS 인증서 체인 검증", 3,
    !tlsRes ? "na" : tlsRes.ok ? "pass" : "fail",
    !tlsRes ? "HTTPS 아님" : tlsRes.ok ? `발급: ${tlsRes.issuer}, 만료: ${tlsRes.validTo}` : `${w[1]} [${tlsRes.code}]`,
    !tlsRes || tlsRes.ok ? "" : "리프 인증서와 중간 인증서를 모두 담은 fullchain 을 서버에 설치하세요. 브라우저는 빠진 중간 인증서를 스스로 받아오지만 대부분의 크롤러와 AI 봇은 그러지 못해 접속 자체가 실패합니다.",
    !tlsRes ? "–" : tlsRes.ok ? "정상" : w[0]);
}
add(S.tech, "redirects", "리다이렉트 체인", 2, page.hops.length <= 1 ? "pass" : page.hops.length <= 3 ? "warn" : "fail",
  page.hops.length ? page.hops.map((h) => `${h.status} ${h.url}`).join(", ") + ` 를 거쳐 ${page.status} ${page.url}` : "입력 URL 이 바로 응답",
  page.hops.length > 1 ? "입력 URL 이 최종 URL 로 한 번에(최대 1홉) 도달하게 규칙을 정리하세요." : "",
  `${page.hops.length}회`);
{
  const star = robots.groups.find((g) => g.agents.includes("*"));
  const blockAll = star?.rules.some((r) => !r.allow && r.path === "/") && !star.rules.some((r) => r.allow);
  const st = !robotsRes.ok ? "warn" : !robotsIsText ? "fail" : blockAll ? "fail" : robots.sitemaps.length ? "pass" : "warn";
  add(S.tech, "robots-txt", "robots.txt", 2, st,
    !robotsRes.ok ? "없으면 전체 허용으로 해석" : !robotsIsText ? "robots.txt 가 HTML 을 반환" : `User-agent 그룹 ${robots.groups.length}개, Sitemap 지시어 ${robots.sitemaps.length}개${blockAll ? ", 전체 차단(Disallow: /)" : ""}`,
    blockAll ? "User-agent: * 에 Disallow: / 가 있어 모든 크롤러가 차단됩니다. 스테이징 설정이 배포되지 않았는지 확인하세요." : st === "pass" ? "" : "robots.txt 에 Sitemap: 절대 URL 을 추가하세요.",
    !robotsRes.ok ? `HTTP ${robotsRes.status}` : !robotsIsText ? "HTML 반환" : blockAll ? "전체 차단" : robots.sitemaps.length ? "Sitemap 있음" : "Sitemap 없음");
}
{
  const sm = sitemapRes.text || "";
  const isXml = sitemapRes.ok && /<(urlset|sitemapindex)[\s>]/i.test(sm);
  const isIndex = /<sitemapindex/i.test(sm);
  const locs = (sm.match(/<loc>/gi) || []).length;
  add(S.tech, "sitemap", "XML 사이트맵", 2, isXml ? "pass" : sitemapRes.ok ? "warn" : "fail",
    isXml ? `${sitemapUrl} (${isIndex ? "사이트맵 인덱스" : "urlset"})` : `${sitemapUrl} HTTP ${sitemapRes.status}${sitemapRes.ok ? ", XML 아님" : ""}`,
    isXml ? "" : "sitemaps.org 형식의 XML 사이트맵을 두고 robots.txt 와 서치 콘솔에 등록하세요. 표준 URL 만, lastmod 는 실제 수정일로.",
    isXml ? `${isIndex ? "하위 맵" : "URL"} ${locs}개` : `HTTP ${sitemapRes.status}`);
}
add(S.tech, "h1", "H1 1개", 2, h1s.length === 1 ? "pass" : h1s.length === 0 ? "fail" : "warn",
  h1s.length ? shortList(h1s.map((h) => h.text), 2) : "H1 없음",
  h1s.length === 1 ? "" : "페이지당 H1 하나로 주제를 선언하고 로고나 위젯 제목에는 H1 을 쓰지 마세요.",
  `${h1s.length}개`);
{
  let skips = 0;
  for (let i = 1; i < allHeadings.length; i++) if (allHeadings[i].level > allHeadings[i - 1].level + 1) skips++;
  const empty = allHeadings.filter((h) => !h.text).length;
  add(S.tech, "heading-order", "헤딩 계층 (레벨 건너뛰기 · 빈 헤딩)", 1, skips + empty === 0 ? "pass" : skips + empty <= 2 ? "warn" : "fail",
    `헤딩 ${allHeadings.length}개 중 레벨 건너뛰기 ${skips}회, 빈 헤딩 ${empty}개`,
    skips + empty === 0 ? "" : "h2 다음 h4 처럼 레벨을 건너뛰지 말고 크기는 CSS 로 조절하세요. 빈 헤딩은 제거하세요.",
    `${skips + empty}건`);
}
add(S.tech, "img-alt", "이미지 alt 속성", 2, imgs.length === 0 ? "na" : grade(pct(imgsWithAlt, imgs.length), 90, 70),
  imgs.length ? `이미지 ${imgs.length}개 중 alt 있음 ${imgsWithAlt}개` : "이미지 없음",
  imgs.length && pct(imgsWithAlt, imgs.length) < 90 ? "모든 이미지에 alt 를 두세요. 장식 이미지는 alt=\"\" 로 비워 두되 속성 자체는 유지합니다." : "",
  imgs.length ? `${pct(imgsWithAlt, imgs.length)}%` : "이미지 없음");
add(S.tech, "internal-links", "내부 링크 · 앵커 텍스트", 2,
  internal.length === 0 ? "fail" : pct(genericCount, internal.length) > 20 ? "warn" : internal.length >= 5 ? "pass" : "warn",
  `모호한 앵커(“여기”, “더보기” 등) ${genericCount}개`,
  internal.length >= 5 && pct(genericCount, internal.length) <= 20 ? "" : "관련 페이지로 본문 내 문맥 링크를 두고, 앵커 텍스트에는 대상 페이지의 주제를 담으세요.",
  `${internal.length}개`);
{
  const m = lh.metrics;
  const good = m ? [m.lcp <= 2500, m.cls <= 0.1, m.tbt <= 200].filter(Boolean).length : 0;
  add(S.tech, "cwv", "Core Web Vitals (랩 측정)", 2,
    !m ? "na" : good === 3 ? "pass" : good >= 2 ? "warn" : "fail",
    !m ? `측정 안 됨 (${lh.reason || lh.error || "Lighthouse 실패"})` : `LCP ${(m.lcp / 1000).toFixed(2)}s, CLS ${m.cls?.toFixed(3)}, TBT ${Math.round(m.tbt)}ms`,
    !m || good === 3 ? "" : "첫 화면 이미지 우선 로드, 이미지 크기 지정, 긴 스크립트 분할이 기본 처방입니다. INP 는 랩에서 TBT 로 대리 측정합니다.",
    !m ? "측정 안 됨" : `${good}/3 좋음`);
}

// ---------- 점수 ----------
const scoreOf = (list) => {
  const s = list.filter((c) => c.score !== null);
  if (!s.length) return null;
  return Math.round((100 * s.reduce((a, c) => a + c.weight * c.score, 0)) / s.reduce((a, c) => a + c.weight, 0));
};
const sections = Object.values(S).map(([name, category]) => {
  const list = checks.filter((c) => c.section === name);
  const counts = { pass: 0, warn: 0, fail: 0, na: 0, info: 0 };
  list.forEach((c) => counts[c.status]++);
  return { name, category, score: scoreOf(list), counts };
});
const categories = ["SEO", "AEO", "GEO"].map((name) => ({ name, score: scoreOf(checks.filter((c) => c.category === name)) }));
const catScores = categories.map((c) => c.score).filter((s) => s != null);
const overall = catScores.length ? Math.round(catScores.reduce((a, b) => a + b, 0) / catScores.length) : null;
const topFixes = checks.filter((c) => c.status === "fail" || c.status === "warn").sort((a, b) => (a.status === b.status ? b.weight - a.weight : a.status === "fail" ? -1 : 1)).slice(0, 5);
if (thin && !HOME) notes.push(`본문이 약 ${words.toLocaleString()}어절로 짧습니다. 즉답 · 출처 · 수치 항목은 홈 · 서비스 페이지에서는 낮게 나오기 쉬우니, 블로그 글 · 가이드 페이지 URL 로 다시 점검해 보세요.`);
if (lh.error) notes.push(`Lighthouse 실행 실패: ${lh.error}`);

const result = {
  tool: "seo-aeo-geo-audit", version: VERSION, url: opts.url, finalUrl: page.url, host, auditedAt: localIso(startedAt),
  formFactor: opts.desktop ? "desktop" : "mobile", pageType, pageTypeInfo: { ...detected, source: opts.pageType ? "지정" : "자동" }, overall, categories, sections, topFixes, checks, notes, lighthouse: lh,
  bots: bots.map(({ probeUa, ...b }) => b),
  facts: { title, description: descs[0] || "", canonical: canonicals[0] || "", h1: h1s.map((h) => h.text), words, headings: allHeadings.length, lists, tables, images: imgs.length, internalLinks: internal.length, externalHosts: [...contentExternalHosts], ldTypes, author: authorName, latestDate: latestDate?.toISOString() || null, llmsTxt: llmsOk, aiTxt: aiTxtOk, sitemap: sitemapUrl },
};

// ---------- 출력 ----------
await mkdir(opts.out, { recursive: true });
const stamp = `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}`;
const slug = finalUrl.pathname.replace(/[^A-Za-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const base = path.join(opts.out, `audit-${host}${slug ? "-" + slug : ""}-${stamp}`);
result.author = opts.author;
result.files = { json: base + ".json", html: base + ".html", pdf: opts.pdf && browser ? base + ".pdf" : null, pages: null, pdfPages: null, pdfBytes: null };
const countPages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

// 흐름 HTML 을 브라우저에서 A4 쪽으로 나눈 뒤, 그 DOM 을 HTML 로 저장하고 같은 DOM 을 PDF 로 인쇄한다.
let reportHtml = renderFlow(result);
if (browser) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 1000 });
  await p.setContent(reportHtml, { waitUntil: "networkidle0", timeout: 45000 }).catch(() => {});
  await p.evaluate(() => document.fonts.ready).catch(() => {});
  result.files.pages = await p.evaluate(paginate);
  reportHtml = "<!doctype html>\n" + (await p.evaluate(() => document.documentElement.outerHTML));
  if (result.files.pdf) {
    const buf = Buffer.from(await p.pdf({ path: result.files.pdf, printBackground: true, preferCSSPageSize: true }));
    result.files.pdfPages = countPages(buf);
    result.files.pdfBytes = buf.length;
  }
  await p.close();
} else notes.push("Chrome 이 없어 쪽 나누기를 하지 못했습니다. HTML 은 한 장으로 이어진 형태입니다.");
await writeFile(base + ".html", reportHtml);
await writeFile(base + ".json", JSON.stringify(result, null, 2));
await browser?.close();

const line = (c) => `${c.name.padEnd(4)} ${c.score ?? "–"}`;
console.log(`\n=== ${host} 점검 결과 ===`);
console.log(`페이지 유형: ${HOME ? "메인 · 소개" : "콘텐츠(글)"} (${opts.pageType ? "직접 지정" : detected.confident ? `자동 판별: ${detected.reasons.join(", ")}` : "자동 판별 실패, 콘텐츠 기준"})`);
console.log(`종합 ${overall ?? "–"}  |  ${categories.map(line).join("  |  ")}`);
if (lh.scores) console.log(`Lighthouse(${lh.formFactor}) 성능 ${lh.scores.performance ?? "–"} · 접근성 ${lh.scores.accessibility ?? "–"} · 권장사항 ${lh.scores["best-practices"] ?? "–"} · SEO ${lh.scores.seo ?? "–"}`);
sections.forEach((s) => console.log(`  - ${s.name}: ${s.score ?? "–"} (통과 ${s.counts.pass} · 주의 ${s.counts.warn} · 실패 ${s.counts.fail})`));
console.log("\n우선 개선 과제:");
topFixes.forEach((c, i) => console.log(`  ${i + 1}. [${c.status === "fail" ? "실패" : "주의"}] ${c.title} — ${c.detail}`));
notes.forEach((n) => console.log(`  ※ ${n}`));
console.log(`\n파일:\n  JSON ${result.files.json}\n  HTML ${result.files.html}${result.files.pages ? ` (${result.files.pages}쪽)` : ""}${result.files.pdf ? `\n  PDF  ${result.files.pdf} (${result.files.pdfPages}쪽, ${Math.round(result.files.pdfBytes / 1024)}KB)` : "\n  PDF  생성 안 됨"}`);
if (result.files.pdf && result.files.pdfPages !== result.files.pages) console.log(`  ! HTML ${result.files.pages}쪽과 PDF ${result.files.pdfPages}쪽이 다릅니다. 쪽 높이를 넘친 블록이 있는지 확인하세요.`);

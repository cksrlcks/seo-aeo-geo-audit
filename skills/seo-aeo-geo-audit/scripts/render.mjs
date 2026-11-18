// render.mjs — 저장된 점검 JSON 으로 보고서 HTML · PDF 만 다시 만든다(점검 · Lighthouse 재실행 없음). 양식 수정용.
// 사용법: node render.mjs <audit-....json> [--review <review.json>] [출력 경로(확장자 제외)]   기본: JSON 과 같은 이름으로 덮어씀
//  --review: Claude 판단 평가(reference/ai-review.md 형식)를 검증해 점검 JSON 의 review 에 합치고 JSON 도 다시 저장한다.

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { paginate, renderFlow } from "./report.mjs";

const args = process.argv.slice(2);
const ri = args.indexOf("--review");
const reviewPath = ri >= 0 ? args.splice(ri, 2)[1] : null;
const [json, outArg] = args;
if (!json || (ri >= 0 && !reviewPath)) { console.error("사용법: node render.mjs <audit-....json> [--review <review.json>] [출력 경로]"); process.exit(1); }
const base = outArg || json.replace(/\.json$/i, "");
const result = JSON.parse(readFileSync(json, "utf8"));

// review.json 검증: 형식이 틀리면 보고서를 만들지 않고 어디가 틀렸는지 알려 준다.
function validateReview(v) {
  const errs = [];
  const num = (x, lo, hi, where) => { if (typeof x !== "number" || !Number.isFinite(x) || x < lo || x > hi) errs.push(`${where}: ${lo} ~ ${hi} 사이 숫자여야 합니다 (받은 값 ${JSON.stringify(x)})`); };
  const str = (x, where) => { if (typeof x !== "string" || !x.trim()) errs.push(`${where}: 빈 문자열이 아니어야 합니다`); };
  if (!Array.isArray(v?.brand?.items) || !v.brand.items.length) errs.push("brand.items: 배열이 필요합니다");
  else v.brand.items.forEach((i, k) => { str(i.platform, `brand.items[${k}].platform`); str(i.found, `brand.items[${k}].found`); num(i.weight, 1, 100, `brand.items[${k}].weight`); num(i.score, 0, i.weight ?? 0, `brand.items[${k}].score`); });
  if (!Array.isArray(v?.eeat) || v.eeat.length !== 4) errs.push("eeat: 4개 항목(경험 · 전문성 · 권위 · 신뢰) 배열이 필요합니다");
  else v.eeat.forEach((e, k) => { str(e.name, `eeat[${k}].name`); str(e.evidence, `eeat[${k}].evidence`); num(e.score, 0, 25, `eeat[${k}].score`); });
  if (!Array.isArray(v?.platforms) || !v.platforms.length) errs.push("platforms: 배열이 필요합니다");
  else v.platforms.forEach((p, k) => { str(p.name, `platforms[${k}].name`); str(p.strengths, `platforms[${k}].strengths`); num(p.score, 0, 100, `platforms[${k}].score`); });
  return errs;
}
if (reviewPath) {
  const review = JSON.parse(readFileSync(reviewPath, "utf8"));
  const errs = validateReview(review);
  if (errs.length) { console.error(`review.json 형식 오류:\n  - ${errs.join("\n  - ")}`); process.exit(1); }
  result.review = review;
}

// ponytail: audit.mjs 의 findChrome 축약본. 경로 목록이 바뀌면 같이 고친다.
const local = process.env.LOCALAPPDATA || "";
const chromePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
if (!chromePath) { console.error("Chrome 을 찾지 못했습니다. CHROME_PATH 를 지정하세요."); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const p = await browser.newPage();
await p.setViewport({ width: 1280, height: 1000 });
await p.setContent(renderFlow(result), { waitUntil: "networkidle0", timeout: 45000 }).catch(() => {});
await p.evaluate(() => document.fonts.ready).catch(() => {});
const pages = await p.evaluate(paginate);
await writeFile(base + ".html", "<!doctype html>\n" + (await p.evaluate(() => document.documentElement.outerHTML)));
await p.pdf({ path: base + ".pdf", printBackground: true, preferCSSPageSize: true });
await browser.close();
if (reviewPath) {
  result.files = { ...result.files, html: base + ".html", pdf: base + ".pdf", pages };
  await writeFile(base + ".json", JSON.stringify(result, null, 2));
}
console.log(`${pages}쪽 → ${base}.html, ${base}.pdf`);

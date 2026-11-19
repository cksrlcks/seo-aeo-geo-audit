// render.mjs — 저장된 점검 JSON 으로 보고서 HTML · PDF 만 다시 만든다(점검 · Lighthouse 재실행 없음). 양식 수정용.
// 사용법: node render.mjs <audit-....json> [--review <review.json>] [출력 경로(확장자 제외)]   기본: JSON 과 같은 이름으로 덮어씀
//  --review: Claude 판단 평가(reference/ai-review.md 형식)를 검증해 점검 JSON 의 review 에 합치고 JSON 도 다시 저장한다.

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { countPages, paginate, renderFlow, REVIEW_BRAND, REVIEW_EEAT, REVIEW_PLATFORMS } from "./report.mjs";

const args = process.argv.slice(2);
const ri = args.indexOf("--review");
const reviewPath = ri >= 0 ? args.splice(ri, 2)[1] : null;
const [json, outArg] = args;
if (!json || (ri >= 0 && !reviewPath)) { console.error("사용법: node render.mjs <audit-....json> [--review <review.json>] [출력 경로]"); process.exit(1); }
const base = outArg || json.replace(/\.json$/i, "");
const result = JSON.parse(readFileSync(json, "utf8"));

// review.json 검증: 형식이 틀리면 보고서를 만들지 않고 어디가 틀렸는지 알려 준다. 필수 · 선택 필드는 reference/ai-review.md 표.
function validateReview(v) {
  const errs = [];
  const num = (x, lo, hi, where) => { if (typeof x !== "number" || !Number.isFinite(x) || x < lo || x > hi) errs.push(`${where}: ${lo} ~ ${hi} 사이 숫자여야 합니다 (받은 값 ${JSON.stringify(x)})`); };
  const str = (x, where) => { if (typeof x !== "string" || !x.trim()) errs.push(`${where}: 빈 문자열이 아니어야 합니다`); };
  const opt = (x, where) => { if (x !== undefined && x !== null && typeof x !== "string") errs.push(`${where}: 문자열이거나 없어야 합니다`); };
  // 이름 · 순서가 기준표와 같은지
  const names = (list, key, want, where) => {
    if (!Array.isArray(list) || list.length !== want.length) return errs.push(`${where}: ${want.length}개 항목(${want.join(" · ")}) 배열이 필요합니다`), false;
    list.forEach((x, k) => { if (x?.[key] !== want[k]) errs.push(`${where}[${k}].${key}: "${want[k]}" 이어야 합니다 (받은 값 ${JSON.stringify(x?.[key])})`); });
    return true;
  };
  if (names(v?.brand?.items, "platform", REVIEW_BRAND.map(([n]) => n), "brand.items"))
    v.brand.items.forEach((i, k) => {
      const w = REVIEW_BRAND[k][1];
      if (i.weight !== w) errs.push(`brand.items[${k}].weight: ${w} 이어야 합니다 (받은 값 ${JSON.stringify(i.weight)})`);
      str(i.found, `brand.items[${k}].found`); num(i.score, 0, w, `brand.items[${k}].score`); opt(i.url, `brand.items[${k}].url`);
    });
  if (names(v?.eeat, "name", REVIEW_EEAT, "eeat"))
    v.eeat.forEach((e, k) => { str(e.evidence, `eeat[${k}].evidence`); str(e.fix, `eeat[${k}].fix`); num(e.score, 0, 25, `eeat[${k}].score`); });
  if (names(v?.platforms, "name", REVIEW_PLATFORMS, "platforms"))
    v.platforms.forEach((p, k) => { str(p.strengths, `platforms[${k}].strengths`); str(p.gaps, `platforms[${k}].gaps`); num(p.score, 0, 100, `platforms[${k}].score`); });
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
const buf = await p.pdf({ path: base + ".pdf", printBackground: true, preferCSSPageSize: true });
const pdfPages = countPages(buf);
await browser.close();
if (reviewPath) {
  result.files = { ...result.files, html: base + ".html", pdf: base + ".pdf", pages, pdfPages, pdfBytes: buf.length };
  await writeFile(base + ".json", JSON.stringify(result, null, 2));
}
console.log(`HTML ${pages}쪽 · PDF ${pdfPages}쪽 → ${base}.html, ${base}.pdf`);
if (pages !== pdfPages) { console.log(`! HTML ${pages}쪽과 PDF ${pdfPages}쪽이 다릅니다. 쪽 높이를 넘친 블록이 있는지 확인하세요.`); process.exitCode = 3; }

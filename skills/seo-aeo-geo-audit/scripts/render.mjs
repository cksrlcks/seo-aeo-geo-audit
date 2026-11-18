// render.mjs — 저장된 점검 JSON 으로 보고서 HTML · PDF 만 다시 만든다(점검 · Lighthouse 재실행 없음). 양식 수정용.
// 사용법: node render.mjs <audit-....json> [출력 경로(확장자 제외)]   기본: JSON 과 같은 이름으로 덮어씀

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { paginate, renderFlow } from "./report.mjs";

const [json, outArg] = process.argv.slice(2);
if (!json) { console.error("사용법: node render.mjs <audit-....json> [출력 경로]"); process.exit(1); }
const base = outArg || json.replace(/\.json$/i, "");
const result = JSON.parse(readFileSync(json, "utf8"));

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
console.log(`${pages}쪽 → ${base}.html, ${base}.pdf`);

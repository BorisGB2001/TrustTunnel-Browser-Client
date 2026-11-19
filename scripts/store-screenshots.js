#!/usr/bin/env node
/*
 * Chrome Web Store screenshots (1280x800 JPEG, no alpha) of extension/ in English and Russian.
 * Demo data only: example servers, no real hosts or credentials. The "connected" state is set
 * directly in the service worker, nothing goes over the network.
 *
 *   NODE_PATH=<dir with puppeteer-core>/node_modules node scripts/store-screenshots.js [out-dir] [chromium]
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "store/screenshots"));
const BROWSER = process.argv[3] || "/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost";
const W = 1280, H = 800;

const TEXT = {
  en: {
    hero: "Browser-only VPN<br>for your TrustTunnel server",
    heroSub: "One click in the toolbar. Only the browser goes through the tunnel — the rest of the system is untouched.",
  },
  ru: {
    hero: "VPN только для браузера<br>через ваш сервер TrustTunnel",
    heroSub: "Одна кнопка на панели. Через туннель идёт только браузер — остальная система не затрагивается.",
  },
};

const PROFILES = [
  { kind: "direct", name: "Amsterdam", hostname: "ams.vpn.example.com", port: 443, username: "alice", password: "demo-password" },
  { kind: "direct", name: "Frankfurt", hostname: "fra.vpn.example.com", port: 443, username: "alice", password: "demo-password" },
  { kind: "socks", name: "Local trusttunnel_client", socksHost: "127.0.0.1", socksPort: 1080 },
];

async function shoot(lang) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-shots-"));
  // macOS Chromium ignores --lang for chrome.i18n, so the extension copy keeps only one locale.
  const ext = path.join(tmp, "ext");
  fs.cpSync(EXT, ext, { recursive: true });
  for (const l of fs.readdirSync(path.join(ext, "_locales")))
    if (l !== lang) fs.rmSync(path.join(ext, "_locales", l), { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json")));
  mf.default_locale = lang;
  fs.writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(mf));
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: true,
    userDataDir: tmp,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--lang=${lang}`, "--no-first-run"],
    env: { ...process.env, LANG: lang === "ru" ? "ru_RU.UTF-8" : "en_US.UTF-8" },
  });
  try {
    const swT = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"));
    const sw = await swT.worker();
    const extId = new URL(swT.url()).host;
    // Demo state: servers, lists, "connected" — without enabling real routing or health checks.
    await sw.evaluate(async (profiles) => {
      await ready;
      healthCheck = async () => {}; // the popup asks for a refresh; keep the demo state
      for (const profile of profiles) await handlers.saveProfile({ profile });
      await saveSettings({
        excludeList: ["mybank.example", "intranet.example.com", "192.168.0.0/16"],
        includeList: ["youtube.com", "googlevideo.com", "instagram.com"],
      });
      settings.enabled = true; // in memory only: no PAC, no alarms
      await setRuntime({ status: "on", error: null, latency: 48, checkedAt: Math.floor(Date.now() / 1000) - 12, since: Math.floor(Date.now() / 1000) - 1840 });
    }, PROFILES);

    const page = await browser.newPage();
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${lang}-${name}.jpg`), type: "jpeg", quality: 92 });

    // 1. Popup on a branded background.
    await page.setViewport({ width: 368, height: 460, deviceScaleFactor: 2 });
    await page.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 600));
    const popupH = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    const popupPng = await page.screenshot({ clip: { x: 0, y: 0, width: 368, height: popupH }, encoding: "base64" });
    const dark = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const t = TEXT[lang];
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <style>
        body{margin:0;width:${W}px;height:${H}px;display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box;
             font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:linear-gradient(135deg,#0f3d2a,#1f8a4c);color:#fff}
        h1{font-size:46px;line-height:1.15;margin:0 0 20px;font-weight:700}
        p{font-size:22px;line-height:1.45;margin:0;color:#d6f2e2;max-width:560px}
        .shot{flex:none;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45);background:${dark ? "#1e1f22" : "#fff"}}
        .shot img{display:block;width:368px}
      </style>
      <div><h1>${t.hero}</h1><p>${t.heroSub}</p></div>
      <div class="shot"><img src="data:image/png;base64,${popupPng}"></div>`);
    await shot("1-popup");

    // 2. Options: servers and routing.
    await page.goto(`chrome-extension://${extId}/options/options.html`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 600));
    await shot("2-servers");

    // 3. Options: add a server (import form open).
    await page.evaluate(() => {
      const d = document.getElementById("editBox");
      if (d) { d.open = true; d.scrollIntoView({ block: "start" }); window.scrollBy(0, -16); }
    });
    await new Promise((r) => setTimeout(r, 400));
    await shot("3-add-server");
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const lang of ["en", "ru"]) await shoot(lang);
  console.log(fs.readdirSync(OUT).map((f) => path.join(OUT, f)).join("\n"));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

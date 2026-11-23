#!/usr/bin/env node
/*
 * Chrome build (extension/) against a LIVE TrustTunnel server.
 * The tt:// key (or TOML) is read from a file and never stored anywhere.
 *
 *   NODE_PATH=<dir with puppeteer-core>/node_modules node scripts/e2e-live.js <key-file> [path-to-chromium]
 *
 * Two runs in throw-away profiles:
 *   1. normal certificate checks — a self-signed server must show the "certificate" hint
 *      (a Let's Encrypt server must simply connect);
 *   2. with --ignore-certificate-errors (stands in for importing the certificate) — the tunnel
 *      must come up, pages must load and the external IP must differ from the direct one.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const [keyFile, browserPath] = process.argv.slice(2);
const BROWSER = browserPath || "/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost";
if (!keyFile) {
  console.error("usage: e2e-live.js <key-file> [path-to-chromium]");
  process.exit(2);
}
const KEY = fs.readFileSync(keyFile, "utf8").trim();

let failed = 0;
function check(name, ok, extra = "") {
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  — " + extra : ""));
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function directIp() {
  return new Promise((resolve) => {
    https.get("https://api.ipify.org?format=json", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve(JSON.parse(b).ip));
    }).on("error", () => resolve(null));
  });
}

async function run({ ignoreCert }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-live-"));
  const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run"];
  if (ignoreCert) args.push("--ignore-certificate-errors");
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: true,
    userDataDir: tmp,
    ignoreDefaultArgs: ["--disable-extensions"],
    args,
  });
  try {
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"), { timeout: 15000 });
    const sw = await swTarget.worker();
    const call = (type, a = {}) =>
      sw.evaluate(async (type, a) => { await ready; return handlers[type](a); }, type, a);

    const { profile } = await call("parseConfig", { text: KEY, name: "key" });
    await call("saveProfile", { profile });
    const st = await call("setEnabled", { value: true });
    return { browser, sw, call, st, profile, tmp };
  } catch (e) {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

async function main() {
  const ip0 = await directIp();
  console.log("direct IP:", ip0);

  // ---- 1. Without trusting the certificate.
  let r = await run({ ignoreCert: false });
  const selfSigned = !!r.profile.certificate;
  console.log(`server ${r.profile.hostname}:${r.profile.port}, self-signed cert in key: ${selfSigned}`);
  if (selfSigned) {
    check("untrusted self-signed cert → certificate hint", r.st.runtime.status === "error" && /ERR_PROXY_CERTIFICATE_INVALID|ERR_CERT/.test(r.st.runtime.error || ""), r.st.runtime.error);
  } else {
    check("public cert → connected", r.st.runtime.status === "on", r.st.runtime.error || `latency ${r.st.runtime.latency} ms`);
  }
  await r.browser.close();
  fs.rmSync(r.tmp, { recursive: true, force: true });

  // ---- 2. Certificate trusted (simulated) → full tunnel.
  r = await run({ ignoreCert: true });
  try {
    check("tunnel up", r.st.runtime.status === "on", r.st.runtime.error || `latency ${r.st.runtime.latency} ms`);
    const ps = await r.sw.evaluate(() => chrome.proxy.settings.get({}));
    check("PAC controlled by extension", ps.levelOfControl === "controlled_by_this_extension", ps.levelOfControl);

    const ip = await r.call("checkIp");
    const vpnIp = ip.vpn && ip.vpn.ip, dirIp = ip.direct && ip.direct.ip;
    check("Check IP: VPN address differs from the direct one", vpnIp && dirIp && vpnIp !== dirIp, `direct ${dirIp} / VPN ${vpnIp}`);
    check("Check IP: direct address is the real one", dirIp === ip0, `${dirIp} vs ${ip0}`);

    const page = await r.browser.newPage();
    for (const url of ["https://example.com/", "https://www.wikipedia.org/"]) {
      const t0 = Date.now();
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => e);
      const ok = res && res.status && res.status() < 400;
      check("page " + url, ok, ok ? `${res.status()} in ${Date.now() - t0} ms` : String(res && res.message));
    }

    // Split tunnelling: an excluded site is loaded past the tunnel.
    await r.call("setSettings", { patch: { excludeList: ["ifconfig.me"] } });
    await sleep(500);
    const seen = await page.goto("https://ifconfig.me/ip", { waitUntil: "domcontentloaded", timeout: 30000 })
      .then(() => page.evaluate(() => document.body.innerText.trim())).catch((e) => String(e.message));
    check("excluded site goes direct", seen === ip0, `${seen} vs ${ip0}`);

    await r.call("setEnabled", { value: false });
  } finally {
    await r.browser.close();
    fs.rmSync(r.tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

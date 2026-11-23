#!/usr/bin/env node
/*
 * End-to-end check of the Chrome build (extension/) against a local fake TrustTunnel server:
 * an HTTPS proxy that answers CONNECT with Basic auth (407 + Proxy-Authenticate otherwise).
 *
 *   NODE_PATH=<dir with puppeteer-core>/node_modules node scripts/e2e.js [path-to-chromium]
 *
 * Needs a Chromium that still accepts --load-extension (branded Google Chrome 137+ does not;
 * Chromium / Chrome for Testing / Chromium-Gost do). The proxy cert is self-signed, so the
 * browser runs with --ignore-certificate-errors.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const tls = require("tls");
const https = require("https");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const BROWSER = process.argv[2] || "/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost";
const USER = "test";
let PASS = "secret";

// ---------------------------------------------------------------- fake server
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-e2e-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", tmp + "/k.pem",
  "-out", tmp + "/c.pem", "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
  { stdio: "ignore" });

const log = []; // "<status> host:port"
const tunnels = new Set();
const proxy = https.createServer({ key: fs.readFileSync(tmp + "/k.pem"), cert: fs.readFileSync(tmp + "/c.pem") });
proxy.on("connect", (req, sock, head) => {
  tunnels.add(sock);
  sock.on("close", () => tunnels.delete(sock));
  const want = "Basic " + Buffer.from(USER + ":" + PASS).toString("base64");
  if (req.headers["proxy-authorization"] !== want) {
    log.push("407 " + req.url);
    sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="tt"\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  log.push("200 " + req.url);
  const [h, p] = req.url.split(":");
  const up = net.connect(Number(p) || 443, h, () => {
    sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
  sock.on("error", () => up.destroy());
});

// ---------------------------------------------------------------- helpers
let failed = 0;
function check(name, ok, extra = "") {
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  — " + extra : ""));
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sawConnect = (host, code = "200") => log.some((l) => l === `${code} ${host}:443`);

async function main() {
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const port = proxy.address().port;
  console.log("fake TrustTunnel server on https://localhost:" + port);

  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: true,
    userDataDir: tmp + "/profile",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--ignore-certificate-errors",
      "--no-first-run",
    ],
  });
  try {
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"), { timeout: 15000 });
    const sw = await swTarget.worker();
    const call = (type, args = {}) => sw.evaluate(async (type, args) => { await ready; return handlers[type](args); }, type, args);
    const proxySettings = () => sw.evaluate(() => chrome.proxy.settings.get({}));
    check("service worker started", !!sw, swTarget.url());

    // 0. Credentials not confirmed yet: pages are held back (kill switch) instead of a password prompt.
    await call("saveProfile", { profile: { kind: "direct", name: "local", hostname: "localhost", port, username: USER, password: PASS } });
    await sw.evaluate(async () => { const real = healthCheck; healthCheck = async () => {}; await saveSettings({ enabled: true }); healthCheck = real; });
    const p0 = await browser.newPage();
    const r0 = await p0.goto("https://example.com/", { waitUntil: "domcontentloaded", timeout: 15000 }).catch((e) => e);
    check("before auth is confirmed, pages are held", !(r0 && r0.status) && !log.some((l) => l.includes("example.com")), String(r0 && r0.message));
    await p0.close();
    await sw.evaluate(async () => saveSettings({ enabled: false }));

    // 1. Connect.
    let st = await call("setEnabled", { value: true });
    check("health check through tunnel → on", st.runtime.status === "on", JSON.stringify(st.runtime));
    check("health probe went through CONNECT with auth", sawConnect("connectivitycheck.gstatic.com"));
    check("first CONNECT got 407 (Chrome answers the challenge)", log.some((l) => l.startsWith("407 ")));
    let ps = await proxySettings();
    check("PAC applied and controlled by us", ps.value.mode === "pac_script" && ps.levelOfControl === "controlled_by_this_extension", ps.levelOfControl);

    // 2. A page goes through the tunnel.
    const page = await browser.newPage();
    const r1 = await page.goto("https://example.com/", { waitUntil: "domcontentloaded" }).catch((e) => e);
    check("example.com loads", r1 && r1.status && r1.status() === 200, String(r1 && r1.message || ""));
    check("example.com went via tunnel", sawConnect("example.com"));

    // 3. Split tunnelling: excluded site goes direct.
    await call("setSettings", { patch: { excludeList: ["example.org"] } });
    const r2 = await page.goto("https://example.org/", { waitUntil: "domcontentloaded" }).catch((e) => e);
    check("excluded example.org loads", r2 && r2.status && r2.status() === 200);
    check("excluded example.org did NOT use tunnel", !log.some((l) => l.includes("example.org")));

    // 3a. Check IP: one host is forced through the tunnel, the other goes direct even with the VPN on.
    const ipRes = await call("checkIp");
    check("Check IP: both addresses answered", !!(ipRes.vpn && ipRes.vpn.ip && ipRes.direct && ipRes.direct.ip), JSON.stringify(ipRes));
    check("Check IP: VPN address asked through the tunnel", sawConnect("api.ipify.org"));
    check("Check IP: direct address asked past the tunnel", !log.some((l) => l.includes("api4.ipify.org")));

    // 3b. Toolbar icon menu and hotkey.
    st = await call("getState");
    check("state carries the version", st.version === require(path.join(EXT, "manifest.json")).version, st.version);
    await call("saveProfile", { profile: { kind: "socks", name: "second", socksHost: "127.0.0.1", socksPort: 1080 } });
    await sw.evaluate(() => menusBuilding);
    const cmds = await sw.evaluate(() => chrome.commands.getAll());
    check("hotkey command registered", cmds.some((c) => c.name === "toggle-vpn"), JSON.stringify(cmds.map((c) => c.name)));
    const second = (await call("getState")).profiles.find((p) => p.name === "second");
    await call("deleteProfile", { id: second.id });
    const pred = await sw.evaluate(() => chrome.privacy.network.networkPredictionEnabled.get({}));
    check("network prediction off while the VPN is on", pred.value === false && pred.levelOfControl === "controlled_by_this_extension", JSON.stringify(pred));
    st = await call("setSettings", { patch: { statsUrl: "https://panel.example.com/me" } });
    check("statistics URL saved", st.settings.statsUrl === "https://panel.example.com/me");
    const bad = await call("setSettings", { patch: { statsUrl: "javascript:alert(1)" } }).then(() => "accepted", () => "rejected");
    check("non-http statistics URL rejected", bad === "rejected", bad);

    // 4. Password changed on the server → our stored one is rejected → auth error.
    const list = (await call("getState")).profiles;
    PASS = "rotated";
    for (const s of tunnels) s.destroy(); // Chrome would otherwise reuse the open tunnel
    await sw.evaluate(() => healthCheck());
    st = await call("getState");
    check("rejected password → error status", st.runtime.status === "error", JSON.stringify(st.runtime));
    await call("saveProfile", { profile: { ...list[0], password: PASS } });
    st = await call("getState");
    check("correct password again → on", st.runtime.status === "on", st.runtime.error || "");

    // 5. Kill switch: server down → error, page blocked.
    proxy.close();
    for (const s of tunnels) s.destroy();
    await sleep(300);
    await sw.evaluate(() => healthCheck());
    st = await call("getState");
    check("server down → error status", st.runtime.status === "error", st.runtime.error);
    const r3 = await page.goto("https://example.net/", { waitUntil: "domcontentloaded", timeout: 15000 }).catch((e) => e);
    check("kill switch blocks traffic when server is down", !(r3 && r3.status && r3.status() === 200), String(r3 && r3.message || r3.status && r3.status()));

    // 6. Turn off → proxy settings released.
    await call("setEnabled", { value: false });
    ps = await proxySettings();
    check("disabled → proxy settings cleared", ps.levelOfControl !== "controlled_by_this_extension", ps.levelOfControl);

    // 7. Popup and options pages render without errors.
    const extId = new URL(swTarget.url()).host;
    for (const pg of ["popup/popup.html", "options/options.html"]) {
      const p = await browser.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      await p.goto(`chrome-extension://${extId}/${pg}`, { waitUntil: "load" });
      await sleep(500);
      if (pg.startsWith("options")) await p.screenshot({ path: path.join(ROOT, "dist/e2e-options.png"), fullPage: true });
      else await p.screenshot({ path: path.join(ROOT, "dist/e2e-popup.png") });
      check(pg + " renders without errors", errs.length === 0, errs.join("; "));
    }
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log("\nproxy log:", log.join(", "));
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

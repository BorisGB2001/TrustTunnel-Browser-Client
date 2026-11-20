/*
 * TrustTunnel Browser Client — background (Firefox event page / Chrome service worker).
 *
 * TrustTunnel is HTTP CONNECT over TLS with Basic auth, so the browser talks to the
 * server itself as to an HTTPS proxy.
 *   Firefox: proxy.onRequest -> type "https" with a preset Proxy-Authorization header.
 *   Chrome:  proxy.settings with a generated PAC script ("HTTPS host:port"),
 *            credentials are given in webRequest.onAuthRequired after the 407.
 * Alternative: the local SOCKS5 listener of the official trusttunnel_client.
 */
"use strict";

// Chrome has no proxy.onRequest; everything Chrome-specific hangs off this flag.
const IS_CHROME = !(browser.proxy && browser.proxy.onRequest);

const HEALTH_ALARM = "tt-health";
// Chrome's PAC sees only the host of https URLs, so the probe gets a host of its own
// that the PAC script always sends through the tunnel.
const HEALTH_URL = IS_CHROME
  ? "https://connectivitycheck.gstatic.com/generate_204"
  : "https://www.gstatic.com/generate_204";
const HEALTH_HOST = new URL(HEALTH_URL).hostname;
const HEALTH_ORIGIN = `https://${HEALTH_HOST}/*`;

const DEFAULTS = {
  enabled: false,
  profileId: null,
  profiles: [], // [{id, kind:"direct"|"socks", name, hostname, port, username, password, socksHost, socksPort, ...}]
  mode: "exclude",
  excludeList: [],
  includeList: [],
  bypassLocal: true,
  killSwitch: true,
  webrtcProtect: true,
};

let settings = { ...DEFAULTS };
let rt = { status: "off", error: null, latency: null, checkedAt: null, since: null };
let healthNonce = null; // marks our own health-check request
let authFails = 0;
// Chrome: "proxy|user" whose credentials Chrome already holds in its auth cache this session.
// The extension has no host permission for websites, so it cannot answer a 407 for a page —
// only for its own health probe. Until the probe has authenticated, pages are held back.
let warmKey = null;

const ready = (async () => {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  settings = { ...DEFAULTS, ...stored };
  try {
    const s = await browser.storage.session.get(["rt", "warmKey"]);
    if (s.rt) rt = { ...rt, ...s.rt };
    warmKey = s.warmKey || null;
  } catch (_) {}
  updateBadge();
  if (IS_CHROME) await applyChromeProxy();
})();

// ------------------------------------------------------------------ state helpers

const currentProfile = () => settings.profiles.find((p) => p.id === settings.profileId) || null;

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await browser.storage.local.set(patch);
  // Chrome keeps routing in a PAC script, so it is rebuilt on every change.
  if (IS_CHROME) await applyChromeProxy();
}

async function setRuntime(patch) {
  rt = { ...rt, ...patch };
  try {
    await browser.storage.session.set({ rt });
  } catch (_) {}
  updateBadge();
  browser.runtime.sendMessage({ type: "stateChanged" }).catch(() => {});
}

// Chrome cannot draw SVG toolbar icons.
const iconPath = (name) =>
  IS_CHROME ? { 16: `icons/${name}-16.png`, 32: `icons/${name}-32.png` } : `icons/${name}.svg`;

function updateBadge() {
  let text = "", color = "#9e9e9e", title = t("titleOff"), icon = "icon-off";
  if (settings.enabled) {
    if (rt.status === "on") {
      [text, color, title, icon] = ["ON", "#2e7d32", t("titleOn"), "icon-on"];
    } else if (rt.status === "connecting") {
      [text, color, title] = ["…", "#ef6c00", t("titleConnecting")];
    } else if (rt.status === "error") {
      [text, color, title, icon] = ["!", "#c62828", t("titleError", rt.error || ""), "icon-err"];
    }
  }
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
  browser.action.setTitle({ title });
  browser.action.setIcon({ path: iconPath(icon) });
}

async function applyWebRtc(on) {
  try {
    const setting = browser.privacy.network.webRTCIPHandlingPolicy;
    if (on && settings.webrtcProtect) await setting.set({ value: "disable_non_proxied_udp" });
    else await setting.clear({});
  } catch (e) {
    console.warn("WebRTC policy:", e);
  }
}

function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(user + ":" + pass);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

// ------------------------------------------------------------------ proxy routing

const DIRECT = { type: "direct" };

function proxyFor(p) {
  if (p.kind === "socks") {
    return {
      type: "socks",
      host: p.socksHost || "127.0.0.1",
      port: Number(p.socksPort) || 1080,
      username: p.socksUser || undefined,
      password: p.socksPass || undefined,
      proxyDNS: true,
      failoverTimeout: 5,
    };
  }
  return {
    type: "https",
    host: p.hostname,
    port: Number(p.port) || 443,
    proxyAuthorizationHeader: basicAuth(p.username, p.password),
    failoverTimeout: 5,
  };
}

if (!IS_CHROME) browser.proxy.onRequest.addListener(
  async (details) => {
    await ready;
    if (!settings.enabled) return DIRECT;
    const p = currentProfile();
    if (!p) return settings.killSwitch ? { type: "http", host: "127.0.0.1", port: 9 } : DIRECT;
    // Our own health probe always goes through the tunnel and never fails over.
    if (healthNonce && details.url.includes("tt-health=" + healthNonce)) return proxyFor(p);
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch (_) {
      return DIRECT;
    }
    // The VPN server itself is always reached directly (e.g. opening it to check the certificate).
    if (p.kind !== "socks" && host === p.hostname) return DIRECT;
    if (!TTRules.shouldTunnel(host, settings)) return DIRECT;
    // Kill switch on: only the tunnel, the request fails if it is down.
    // Kill switch off: Firefox falls back to a direct connection.
    return settings.killSwitch ? proxyFor(p) : [proxyFor(p), DIRECT];
  },
  { urls: ["<all_urls>"] }
);

// ---- Chrome: the same decisions, compiled into a PAC script.

/** PAC proxy string for a profile; Chrome has no SOCKS auth and no failover timeout. */
function pacProxyFor(p) {
  if (p.kind === "socks") return `SOCKS5 ${p.socksHost || "127.0.0.1"}:${Number(p.socksPort) || 1080}`;
  return `HTTPS ${p.hostname}:${Number(p.port) || 443}`;
}

const keyFor = (p) => (p ? pacProxyFor(p) + "|" + (p.kind === "socks" ? "" : p.username) : null);

async function setWarm(key) {
  if (key === warmKey) return;
  warmKey = key;
  try {
    await browser.storage.session.set({ warmKey: key });
  } catch (_) {}
  await applyChromeProxy();
}

function buildPac() {
  const p = currentProfile();
  const cfg = {
    proxy: p ? pacProxyFor(p) : "PROXY 127.0.0.1:9", // nowhere: kill switch without a server
    server: p && p.kind !== "socks" ? p.hostname : null,
    health: HEALTH_HOST,
    // Credentials not confirmed yet (no SOCKS auth in Chrome, so SOCKS never waits).
    hold: !!p && p.kind !== "socks" && keyFor(p) !== warmKey,
    killSwitch: !!settings.killSwitch,
    rules: {
      mode: settings.mode,
      excludeList: settings.excludeList.map(toAsciiHost),
      includeList: settings.includeList.map(toAsciiHost),
      bypassLocal: settings.bypassLocal,
    },
  };
  // Chrome rejects PAC data with non-ASCII characters; \uXXXX escapes are fine in JS.
  return asciiOnly(`var TTRules = (${TTRulesFactory.toString()})();
var CFG = ${JSON.stringify(cfg)};
function FindProxyForURL(url, host) {
  host = String(host || "").toLowerCase();
  if (host === CFG.health) return CFG.proxy;
  if (CFG.server && host === CFG.server) return "DIRECT";
  if (!TTRules.shouldTunnel(host, CFG.rules)) return "DIRECT";
  if (CFG.hold) return CFG.killSwitch ? "PROXY 127.0.0.1:9" : "DIRECT";
  return CFG.killSwitch ? CFG.proxy : CFG.proxy + "; DIRECT";
}`);
}

const asciiOnly = (s) => s.replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** PAC receives hosts in punycode, so IDN list entries are converted the same way. */
function toAsciiHost(entry) {
  if (entry.includes("/") || /^[\x00-\x7f]*$/.test(entry)) return entry;
  try {
    return new URL("http://" + entry).hostname;
  } catch (_) {
    return entry;
  }
}

let proxyApplied = null; // last PAC text (or "" when cleared), to skip no-op updates

async function applyChromeProxy() {
  const want = settings.enabled && (currentProfile() || settings.killSwitch) ? buildPac() : "";
  if (want === proxyApplied) return;
  try {
    if (want) {
      await browser.proxy.settings.set({
        value: { mode: "pac_script", pacScript: { data: want, mandatory: !!settings.killSwitch } },
        scope: "regular",
      });
    } else {
      await browser.proxy.settings.clear({ scope: "regular" });
    }
    proxyApplied = want;
    if (want) {
      const cur = await browser.proxy.settings.get({});
      if (cur.levelOfControl !== "controlled_by_this_extension") {
        proxyApplied = null;
        await setRuntime({ status: "error", error: t("errProxyControl") });
      }
    }
  } catch (e) {
    proxyApplied = null;
    console.warn("proxy.settings:", e);
    await setRuntime({ status: "error", error: String((e && e.message) || e) });
  }
}

if (browser.proxy.onError) browser.proxy.onError.addListener((err) => console.warn("proxy error:", err && err.message));

// ---- 407 from the server.
// Firefox: fallback if the server ignores the preset header.
// Chrome: the normal path — Chrome never sends proxy credentials before the challenge
// and then caches them; a second challenge for the same request means they were rejected.
const authSeen = new Set();

async function onAuth(details) {
  await ready;
  const p = currentProfile();
  if (!details.isProxy || !settings.enabled || !p) return {};
  const sameHost = p.kind === "socks" || (details.challenger && details.challenger.host === p.hostname);
  if (!sameHost) return {};
  let rejected;
  if (IS_CHROME) {
    rejected = authSeen.has(details.requestId);
    if (authSeen.size > 500) authSeen.clear();
    authSeen.add(details.requestId);
  } else {
    rejected = ++authFails > 3;
  }
  if (p.kind === "socks" || rejected) {
    if (IS_CHROME) await setWarm(null);
    await setRuntime({ status: "error", error: t("errAuth407") });
    return { cancel: true };
  }
  return { authCredentials: { username: p.username, password: p.password } };
}

if (IS_CHROME) {
  browser.webRequest.onAuthRequired.addListener(
    (details, callback) => {
      onAuth(details).then(callback, () => callback({}));
    },
    { urls: ["<all_urls>"] },
    ["asyncBlocking"]
  );
} else {
  browser.webRequest.onAuthRequired.addListener(onAuth, { urls: ["<all_urls>"] }, ["blocking"]);
}

// ------------------------------------------------------------------ health check

// Firefox's own error code for the last health request (fetch only says "NetworkError").
let healthErrorCode = null;
// HTTP status of the last health response. Chrome's probe is a no-cors fetch (some installs enforce
// CORS on it despite the host permission and fail with net::ERR_FAILED), so the opaque response
// hides the status; webRequest still sees it.
let healthStatus = null;
browser.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (healthNonce && d.url.includes("tt-health=" + healthNonce)) healthStatus = d.statusCode;
  },
  { urls: [HEALTH_URL + "*"] }
);
browser.webRequest.onErrorOccurred.addListener(
  (d) => {
    if (healthNonce && d.url.includes("tt-health=" + healthNonce)) healthErrorCode = d.error;
  },
  { urls: [HEALTH_URL + "*"] }
);

// Firefox codes (NS_ERROR_*, SEC_ERROR_*) and Chrome ones (net::ERR_*).
const ERROR_HINTS = [
  [/SEC_ERROR_UNKNOWN_ISSUER|SELF_SIGNED|UNTRUSTED_ISSUER|CA_CERT_INVALID|SEC_ERROR_BAD_SIGNATURE|ERR_PROXY_CERTIFICATE_INVALID|ERR_CERT_AUTHORITY_INVALID/,
    "hintCert"],
  [/BAD_CERT_DOMAIN|ERR_CERT_COMMON_NAME_INVALID/, "hintCertDomain"],
  [/EXPIRED|ERR_CERT_DATE_INVALID/, "hintCertExpired"],
  [/PROXY_AUTHENTICATION_FAILED|407|ERR_PROXY_AUTH|ERR_INVALID_AUTH_CREDENTIALS/, "hintAuth"],
  [/UNKNOWN_PROXY_HOST|UNKNOWN_HOST|ERR_NAME_NOT_RESOLVED/, "hintDns"],
  [/PROXY_CONNECTION_REFUSED|CONNECTION_REFUSED|ERR_PROXY_CONNECTION_FAILED/, "hintRefused"],
  [/TIMEOUT|TIMED_OUT/, "hintTimeout"],
  [/NET_RESET|NET_INTERRUPT|SSL_ERROR|NS_ERROR_NET_PARTIAL_TRANSFER|ERR_SSL_|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/,
    "hintTlsReset"],
  [/PROXY_BAD_GATEWAY|PROXY_GATEWAY_TIMEOUT|PROXY_FORBIDDEN|ERR_TUNNEL_CONNECTION_FAILED/, "hintBadGateway"],
];

function explain(e, code) {
  const msg = e && e.message ? e.message : String(e);
  if (e && e.name === "AbortError") return t("errTimeout");
  const p = currentProfile();
  if (p && p.kind === "socks" && (!code || /CONNECTION_REFUSED|NetworkError/.test(code + msg)))
    return t("errSocks", (p.socksHost || "127.0.0.1") + ":" + (p.socksPort || 1080));
  if (code) {
    const hit = ERROR_HINTS.find(([re]) => re.test(code));
    return (hit ? t(hit[1]) : t("errConnectGeneric")) + " [" + code + "]";
  }
  if (/NetworkError|Failed to fetch/i.test(msg))
    return t("errNetwork");
  return msg;
}

async function healthCheck({ quiet = false, retry = true } = {}) {
  if (!settings.enabled) return;
  const p = currentProfile();
  if (!p) {
    await setRuntime({ status: "error", error: t("errNoServer") });
    return;
  }
  if (IS_CHROME) {
    await applyChromeProxy();
    // Proxy not in our hands (another extension or policy): the probe would go direct and lie.
    if (proxyApplied === null) return;
  }
  // Chrome lets users switch off an extension's site access; without it Chrome neither answers
  // the proxy's 407 for us nor shows us the probe.
  if (IS_CHROME && !(await browser.permissions.contains({ origins: [HEALTH_ORIGIN] }))) {
    await setWarm(null);
    await setRuntime({ status: "error", error: t("errHostAccess"), needsAccess: true, latency: null, since: null });
    return;
  }
  if (rt.needsAccess) await setRuntime({ needsAccess: false });
  if (!quiet && rt.status !== "on") await setRuntime({ status: "connecting", error: null });
  healthNonce = Math.random().toString(36).slice(2);
  healthErrorCode = null;
  healthStatus = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  const t0 = performance.now();
  try {
    const r = await fetch(HEALTH_URL + "?tt-health=" + healthNonce, {
      cache: "no-store",
      credentials: "omit",
      mode: IS_CHROME ? "no-cors" : "cors",
      signal: ctrl.signal,
    });
    // Chrome hands the proxy's 407 to fetch when the auth challenge is cancelled.
    const status = r.type === "opaque" ? healthStatus : r.status;
    if (status === 407) {
      if (IS_CHROME) await setWarm(null);
      await setRuntime({ status: "error", error: t("errAuth407"), latency: null, since: null });
      return;
    }
    if (status >= 500) throw new Error(t("errHealthHttp", status));
    authFails = 0;
    // The probe got through, so Chrome now holds the proxy credentials: let pages through.
    if (IS_CHROME) await setWarm(keyFor(p));
    await setRuntime({
      status: "on",
      error: null,
      latency: Math.round(performance.now() - t0),
      checkedAt: Math.floor(Date.now() / 1000),
      since: rt.status === "on" && rt.since ? rt.since : Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    if (rt.status === "error" && /407/.test(rt.error || "")) return; // keep the auth message
    // onErrorOccurred may fire just after fetch rejects.
    if (!healthErrorCode) await new Promise((r) => setTimeout(r, 300));
    console.warn("health check failed:", healthErrorCode, e);
    // One-off failures (a pooled proxy connection the server already closed, a network switch
    // after sleep) end in a generic net::ERR_FAILED: probe once more before showing an error.
    if (retry && !(e && e.name === "AbortError") && settings.enabled) {
      clearTimeout(timer);
      healthNonce = null;
      await new Promise((r) => setTimeout(r, 1500));
      return healthCheck({ quiet: true, retry: false });
    }
    await setRuntime({ status: "error", error: explain(e, healthErrorCode), latency: null, since: null });
  } finally {
    clearTimeout(timer);
    healthNonce = null;
  }
}

async function setEnabled(value) {
  await saveSettings({ enabled: !!value });
  authFails = 0;
  authSeen.clear();
  if (value) {
    browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
    await applyWebRtc(true);
    await healthCheck();
  } else {
    browser.alarms.clear(HEALTH_ALARM);
    await applyWebRtc(false);
    await setRuntime({ status: "off", error: null, latency: null, checkedAt: null, since: null });
  }
}

// ------------------------------------------------------------------ lifecycle

async function resume() {
  await ready;
  if (!settings.enabled) return;
  browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
  await applyWebRtc(true);
  await healthCheck();
}

browser.runtime.onStartup.addListener(resume);
browser.runtime.onInstalled.addListener(async (details) => {
  await resume();
  if (details.reason === "install") browser.runtime.openOptionsPage();
});
browser.alarms.onAlarm.addListener(async (a) => {
  await ready;
  if (a.name === HEALTH_ALARM) await healthCheck({ quiet: true });
});

// ------------------------------------------------------------------ messages from popup/options

function publicProfile(p) {
  const { password, socksPass, ...rest } = p;
  return { ...rest, hasPassword: !!password, hasCert: !!p.certificate, certificate: undefined };
}

async function getState() {
  const { profiles, ...s } = settings;
  return { settings: s, profiles: profiles.map(publicProfile), runtime: rt };
}

function cleanProfile(input, old = {}) {
  const kind = input.kind === "socks" ? "socks" : "direct";
  const p = { ...old, ...input, kind };
  p.name = String(p.name || "").trim() || p.hostname || "TrustTunnel";
  p.hostname = String(p.hostname || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  p.port = Number(p.port) || 443;
  p.username = String(p.username || "");
  // An empty password field in the form means "keep the stored one".
  p.password = input.password ? String(input.password) : old.password || "";
  p.socksHost = String(p.socksHost || "127.0.0.1").trim();
  p.socksPort = Number(p.socksPort) || 1080;
  p.socksUser = String(p.socksUser || "");
  p.socksPass = input.socksPass ? String(input.socksPass) : old.socksPass || "";
  if (kind === "direct") {
    if (!p.hostname) throw new Error(t("errHostRequired"));
    if (!p.username || !p.password) throw new Error(t("errCredsRequired"));
  }
  for (const port of [p.port, p.socksPort])
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(t("errPort"));
  delete p.hasPassword;
  delete p.hasCert;
  return p;
}

async function saveProfile({ profile }) {
  const list = [...settings.profiles];
  const idx = profile.id ? list.findIndex((x) => x.id === profile.id) : -1;
  const p = cleanProfile(profile, idx >= 0 ? list[idx] : {});
  // Chrome: a new password is not in Chrome's auth cache yet — hold pages until the probe passes.
  if (IS_CHROME && idx >= 0 && p.id === settings.profileId && p.password !== list[idx].password) await setWarm(null);
  if (idx >= 0) list[idx] = p;
  else {
    p.id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.push(p);
  }
  const patch = { profiles: list };
  if (!settings.profileId) patch.profileId = p.id;
  await saveSettings(patch);
  if (settings.enabled && settings.profileId === p.id) await healthCheck();
  return { profile: publicProfile(p) };
}

async function deleteProfile({ id }) {
  const list = settings.profiles.filter((p) => p.id !== id);
  const patch = { profiles: list };
  if (settings.profileId === id) patch.profileId = list[0] ? list[0].id : null;
  await saveSettings(patch);
  if (settings.enabled) await (patch.profileId ? healthCheck() : setEnabled(false));
  return {};
}

async function checkIp() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store", signal: ctrl.signal });
    const j = await r.json();
    return { ip: j.ip, viaVpn: settings.enabled && TTRules.shouldTunnel("api.ipify.org", settings) };
  } finally {
    clearTimeout(timer);
  }
}

const handlers = {
  getState,
  async setEnabled({ value }) {
    await setEnabled(value);
    return getState();
  },
  async setSettings({ patch }) {
    const allowed = ["profileId", "mode", "excludeList", "includeList", "bypassLocal", "killSwitch", "webrtcProtect"];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ("excludeList" in clean) clean.excludeList = TTRules.parseList(clean.excludeList.join("\n"));
    if ("includeList" in clean) clean.includeList = TTRules.parseList(clean.includeList.join("\n"));
    if ("mode" in clean && !["exclude", "include"].includes(clean.mode)) clean.mode = "exclude";
    if ("profileId" in clean && clean.profileId && !settings.profiles.some((p) => p.id === clean.profileId))
      throw new Error(t("errNoSuchServer"));
    const changedServer = "profileId" in clean && clean.profileId !== settings.profileId;
    await saveSettings(clean);
    if ("webrtcProtect" in clean && settings.enabled) await applyWebRtc(true);
    if (changedServer && settings.enabled) {
      authFails = 0;
      authSeen.clear();
      await setRuntime({ status: "connecting", error: null, since: null });
      await healthCheck();
    }
    return getState();
  },
  async parseConfig({ text, name }) {
    return { profile: TTConfig.parseAny(text, name) };
  },
  saveProfile,
  deleteProfile,
  async getCertificate({ id }) {
    const p = settings.profiles.find((x) => x.id === id);
    return { pem: (p && p.certificate) || "", hostname: p && p.hostname };
  },
  async editList({ list, host, add }) {
    const key = list === "include" ? "includeList" : "excludeList";
    const entry = TTRules.normalizeEntry(host);
    if (!entry) throw new Error(t("errEmptyDomain"));
    const cur = settings[key].filter((e) => e !== entry);
    if (add) cur.push(entry);
    await saveSettings({ [key]: cur });
    return {};
  },
  async refresh() {
    await healthCheck();
    return getState();
  },
  checkIp,
};

// sendResponse + `return true` works in both browsers (Chrome ignores a returned promise).
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id || !msg || !handlers[msg.type]) return undefined;
  ready
    .then(() => handlers[msg.type](msg))
    .then(
      (data) => ({ ok: true, data }),
      (e) => ({ ok: false, error: e && e.message ? e.message : String(e) })
    )
    .then(sendResponse);
  return true;
});

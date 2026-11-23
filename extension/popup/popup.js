"use strict";

const $ = (id) => document.getElementById(id);
let state = null;
let currentHost = null;

const STATUS = {
  off: ["statusOff", ""],
  connecting: ["statusConnecting", "connecting"],
  on: ["statusOn", "on"],
  error: ["statusError", "error"],
};

function current() {
  return state.profiles.find((p) => p.id === state.settings.profileId) || null;
}

function render() {
  const { settings, runtime } = state;
  $("toggle").checked = settings.enabled;
  const key = settings.enabled ? runtime.status : "off";
  const [label, cls] = STATUS[key] || STATUS.off;
  $("statusText").textContent = t(label);
  $("dot").className = "dot " + cls;
  const p = current();
  let sub = "";
  if (key === "error") sub = runtime.error || "";
  else if (key === "on" && p)
    sub = t("popupOnlyBrowser", p.kind === "socks" ? "SOCKS5 " + p.socksHost + ":" + p.socksPort : p.hostname + ":" + p.port);
  else if (!state.profiles.length) sub = t("popupAddServer");
  $("statusSub").textContent = sub;
  $("accessBtn").hidden = !(key === "error" && runtime.needsAccess);

  const sel = $("profile");
  sel.textContent = "";
  if (!state.profiles.length) {
    sel.append(new Option(t("popupNoServers"), ""));
    sel.disabled = true;
  } else {
    sel.disabled = false;
    if (!settings.profileId) sel.append(new Option(t("popupChoose"), ""));
    for (const pr of state.profiles)
      sel.append(new Option(pr.name + (pr.kind === "socks" ? " · SOCKS5" : " · " + pr.hostname), pr.id));
    sel.value = settings.profileId || "";
  }
  $("mode").value = settings.mode;

  $("stats").hidden = key !== "on";
  $("lat").textContent = runtime.latency != null ? t("ms", runtime.latency) : "—";
  $("chk").textContent = fmtAgo(runtime.checkedAt);
  $("since").textContent = fmtSince(runtime.since);
  $("version").textContent = state.version ? "v" + state.version : "";
  $("statsBtn").hidden = !settings.statsUrl;
  renderSite();
}

function renderSite() {
  if (!currentHost || !state) return;
  const { settings } = state;
  const local = TTRules.isLocal(currentHost);
  const tunneled = TTRules.shouldTunnel(currentHost, settings);
  $("siteBox").hidden = false;
  $("siteHost").textContent = currentHost;
  $("siteHost").title = currentHost;
  const route = $("siteRoute");
  route.textContent = t(!settings.enabled ? "routeVpnOff" : tunneled ? "routeVpn" : "routeDirect");
  route.className = "pill" + (settings.enabled && tunneled ? " vpn" : "");

  const btn = $("siteBtn");
  const site = TTRules.siteOf(currentHost);
  btn.disabled = local;
  if (local) {
    btn.textContent = t("siteLocal");
    btn.dataset.action = "";
  } else if (settings.mode === "include") {
    const inList = TTRules.matchesList(currentHost, settings.includeList);
    btn.textContent = t(inList ? "siteIncludeRemove" : "siteIncludeAdd", site);
    btn.dataset.action = inList ? "include:remove" : "include:add";
  } else {
    const inList = TTRules.matchesList(currentHost, settings.excludeList);
    btn.textContent = t(inList ? "siteExcludeRemove" : "siteExcludeAdd", site);
    btn.dataset.action = inList ? "exclude:remove" : "exclude:add";
  }
}

async function refresh() {
  state = await api("getState");
  render();
}

$("toggle").addEventListener("change", async (e) => {
  const value = e.target.checked;
  try {
    state = await api("setEnabled", { value });
    render();
    if (value && state.runtime.status === "on") Toast.ok(t("toastVpnOn"));
    else if (value && state.runtime.status === "error") Toast.error(state.runtime.error);
    else if (!value) Toast.ok(t("toastVpnOff"));
  } catch (err) {
    Toast.error(err.message);
    refresh();
  }
});

$("profile").addEventListener("change", async (e) => {
  try {
    state = await api("setSettings", { patch: { profileId: e.target.value || null } });
    render();
    if (state.settings.enabled && state.runtime.status === "error") Toast.error(state.runtime.error);
    else Toast.ok(t("toastServerSelected"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("mode").addEventListener("change", async (e) => {
  try {
    state = await api("setSettings", { patch: { mode: e.target.value } });
    render();
    Toast.ok(t("toastModeSaved"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("siteBtn").addEventListener("click", async (e) => {
  const [list, op] = (e.target.dataset.action || "").split(":");
  if (!list) return;
  try {
    await api("editList", { list, host: TTRules.siteOf(currentHost), add: op === "add" });
    await refresh();
    Toast.ok(t("toastListUpdated"));
  } catch (err) {
    Toast.error(err.message);
  }
});

// Site access switched off in Chrome: ask for it back (needs this click as the user gesture).
$("accessBtn").addEventListener("click", async () => {
  try {
    const ok = await browser.permissions.request({ origins: ["https://connectivitycheck.gstatic.com/*"] });
    if (!ok) return;
    state = await api("refresh");
    render();
  } catch (err) {
    Toast.error(err.message);
  }
});

function countryName(code) {
  try {
    return new Intl.DisplayNames([browser.i18n.getUILanguage()], { type: "region" }).of(code) || code;
  } catch (_) {
    return code;
  }
}

function showIp(prefix, res) {
  const kind = $(prefix + "Kind");
  const sub = $(prefix + "Sub");
  kind.hidden = sub.hidden = true;
  if (!res) {
    $(prefix).textContent = t("ipVpnOff");
    return;
  }
  if (res.error) {
    $(prefix).textContent = t("ipFailed", res.error);
    return;
  }
  $(prefix).textContent = res.ip;
  const info = res.info;
  if (!info) return;
  kind.textContent = t("ipKind_" + info.kind) || info.kind;
  // An address seen as VPN, proxy, Tor or hosting is what sites may treat as "not a home user".
  kind.className = "pill" + (["vpn", "proxy", "tor", "hosting"].includes(info.kind) ? " warn" : " vpn");
  kind.hidden = false;
  const parts = [];
  if (info.country) parts.push(countryName(info.country));
  if (info.provider) parts.push(info.provider);
  sub.textContent = parts.join(" · ");
  sub.hidden = !parts.length;
}

async function checkIp() {
  const btn = $("ipBtn");
  btn.disabled = true;
  try {
    const res = await api("checkIp");
    $("ipBox").hidden = false;
    showIp("ipVpn", res.vpn);
    showIp("ipDirect", res.direct);
    $("ipInfoBtn").hidden = res.ipInfo;
    const err = (res.vpn && res.vpn.error) || res.direct.error;
    if (err) Toast.error(t("toastIpFailed", err));
  } catch (err) {
    Toast.error(t("toastIpFailed", err.message));
  } finally {
    btn.disabled = false;
  }
}

$("ipBtn").addEventListener("click", checkIp);

// Country, provider and kind come from proxycheck.io: asked only after this click,
// which is also the user gesture Chrome needs to grant access to proxycheck.io.
$("ipInfoBtn").addEventListener("click", async () => {
  try {
    const ok = await browser.permissions.request({ origins: ["https://proxycheck.io/*"] });
    if (!ok) return;
    state = await api("setSettings", { patch: { ipInfo: true } });
    await checkIp();
  } catch (err) {
    Toast.error(err.message);
  }
});

$("statsBtn").addEventListener("click", () => {
  const url = state && state.settings.statsUrl;
  if (!url) return;
  browser.tabs.create({ url });
  window.close();
});

$("optBtn").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "stateChanged") refresh();
});

(async () => {
  applyI18n();
  try {
    await refresh();
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^(https?|wss?):/.test(tab.url)) {
      currentHost = new URL(tab.url).hostname;
      renderSite();
    }
    if (state.settings.enabled) {
      state = await api("refresh");
      render();
    }
  } catch (e) {
    Toast.error(e.message);
  }
})();

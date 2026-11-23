# Chrome Web Store listing — TrustTunnel Browser Client

Texts to paste into the Chrome Web Store Developer Dashboard. Reviewers read English, so the
privacy-tab answers are in English.

## Store listing

| Field | Value |
|---|---|
| Category | Privacy & Security (or Tools) |
| Language | English (default) + Russian |
| Homepage URL | https://github.com/BorisGB2001/TrustTunnel-Browser-Client |
| Support URL | https://github.com/BorisGB2001/TrustTunnel-Browser-Client/issues |
| Official URL | leave empty |
| Mature content | off |

Screenshots (1280×800 JPEG, no alpha): `store/screenshots/en-*.jpg` for English,
`store/screenshots/ru-*.jpg` for Russian. Regenerate with `trusttunnel/scripts/cws-screenshots.js`.

### Description

The store description is **plain text** (no Markdown). Copy it from the text files, not from
this page rendered on GitHub — the rendered view joins the lines:

- English: [`store/description-en.txt`](description-en.txt)
- Russian: [`store/description-ru.txt`](description-ru.txt)

## Privacy practices tab

### Single purpose

Browser-only VPN client: routes Chrome's traffic through the user's own TrustTunnel server (an HTTPS proxy with Basic authentication), with per-site rules for which sites use the tunnel.

### Permission justifications

**proxy**
Core function. The extension applies a PAC script with chrome.proxy.settings so that Chrome sends web traffic through the TrustTunnel server the user configured (HTTPS proxy), and clears it when the VPN is turned off.

**webRequest**
Used only for the extension's own connectivity-check request to connectivitycheck.gstatic.com: to read its network error code (e.g. certificate not trusted, connection refused) and show the user a clear reason why the VPN does not connect. The extension has no access to websites; no page content is read or modified.

**webRequestAuthProvider**
TrustTunnel servers require HTTP Basic proxy authentication. Chrome cannot preset proxy credentials, so the extension answers the server's 407 challenge for its own connectivity-check request with the username and password the user entered for that server; Chrome then reuses them for the proxy. It only responds to proxy challenges from the server the user configured.

**Host permission (https://connectivitycheck.gstatic.com/*)**
The only host the extension has access to. Every 30 seconds while the VPN is on it requests https://connectivitycheck.gstatic.com/generate_204 through the user's server to check that the tunnel works, measure latency and authenticate to the proxy. No access to any website; no content scripts.

**contextMenus**
Adds two items to the right-click menu of the extension's own toolbar icon: "VPN on" (checkbox) and "Server" (list of the user's servers), so the VPN can be switched without opening the popup. No items are added to web pages.

**Optional host permission (https://proxycheck.io/*)**
Not granted at install. Requested only if the user clicks "Show country, provider and address type" in the popup after "Check IP": the extension then asks proxycheck.io about the two IP addresses it has just shown (with the VPN / without it) to display their country, provider and type. Off by default.

**storage**
Stores the user's server profiles (hostname, port, username, password, optional certificate) and settings (routing mode, site lists, kill switch) locally in chrome.storage.local, and the current connection status in chrome.storage.session.

**alarms**
Runs a connectivity check through the tunnel every 30 seconds while the VPN is on, to show the connection status and latency.

**privacy**
Sets chrome.privacy.network.webRTCIPHandlingPolicy to "disable_non_proxied_udp" while the VPN is on (optional setting), so WebRTC cannot leak the user's real IP address around the VPN, and chrome.privacy.network.networkPredictionEnabled to false, so DNS prefetch and preconnect do not reveal site names outside the tunnel. Both are restored when the VPN is turned off.

**tabs**
Reads the URL of the active tab when the popup is open, to show whether the current site goes through the VPN and offer one-click "add this site to the exclusion/inclusion list".

### Remote code

No, I am not using remote code. All JavaScript is packaged in the extension.

### Data usage

"What user data do you plan to collect": tick nothing. The developer receives no data; settings
and credentials stay in the user's Chrome profile. The only thing that leaves the device is the
username/password the user entered, sent to the VPN server the user chose, as proxy authentication
— the user-initiated core function, not collection by the developer (stated in PRIVACY.md).
If a reviewer asks to declare it anyway, tick "Authentication information" and resubmit.

Certifications — tick all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

https://github.com/BorisGB2001/TrustTunnel-Browser-Client/blob/main/PRIVACY.md

## Updating to 1.2.0 (2026-11-23)

New in the package: permission `contextMenus`, optional host permission `https://proxycheck.io/*`,
keyboard command. In the dashboard:

1. Package → Upload new package → `dist/trusttunnel-chrome-1.2.0.zip`.
2. Privacy practices → fill the new justification field **contextMenus** (text above); update the
   **privacy** text; if a host-permission field shows proxycheck.io, use the optional-permission text above.
3. Store listing → replace the descriptions with `store/description-en.txt` / `description-ru.txt`
   and the screenshots with `store/screenshots/*`.
4. Submit for review.

# TrustTunnel Browser Client for Chrome

A Chrome extension: browser-only VPN client for [TrustTunnel](https://github.com/TrustTunnel/TrustTunnel), the open-source VPN protocol by AdGuard. Only the browser's traffic goes through your TrustTunnel server; the rest of the system is untouched. Works in Chrome 120+ and other Chromium browsers (Edge, Brave, Opera, Vivaldi).

[Русская версия](README.ru.md)

> This is an unofficial, community project. It is not affiliated with or endorsed by AdGuard.

## How it works

TrustTunnel is HTTP `CONNECT` over TLS with HTTP Basic authentication — exactly what Chrome speaks to an **HTTPS proxy**. No native helper is needed.

- The extension compiles your routing rules into a PAC script (`HTTPS host:port`) and applies it with `chrome.proxy.settings`.
- Chrome sends `CONNECT` without credentials, the server answers `407 Proxy-Authenticate: Basic`, and the extension supplies the username and password in `webRequest.onAuthRequired` for its own connectivity check; Chrome then reuses them for every page. Until that first check succeeds, pages are held back (or go direct with the kill switch off), so no password prompt appears.
- The extension has **no access to websites**: its only host permission is `connectivitycheck.gstatic.com` for the health check.
- A connectivity check through the tunnel runs every 30 seconds.

For setups a browser cannot handle (HTTP/3-only servers, anti-DPI, `client_random` rules) there is a second mode: Chrome uses the local SOCKS5 listener of the official [`trusttunnel_client`](https://github.com/TrustTunnel/TrustTunnelClient).

## Features

- Import `tt://` deep links and TOML configs (`trusttunnel_client.toml` or the server's `--format toml` export).
- Several servers, quick switching from the toolbar popup.
- Split tunneling: everything except a list, or only listed sites (domains with subdomains, IPv4, CIDR). Local addresses always go direct.
- Kill switch: no direct fallback when the server is unreachable.
- WebRTC leak protection while the VPN is on.
- Check IP: shows your address with the VPN and without it; optionally the country, provider and address type (proxycheck.io, off by default).
- Toolbar icon menu (right click): VPN on/off and server switch. Hotkey `Alt+Shift+V` turns the VPN on or off (change it at `chrome://extensions/shortcuts`).
- Optional "Statistics" button that opens a page you set, for example your account in [TrustPanel](https://github.com/BorisGB2001/TrustPanel).
- DNS prefetch and preconnect are switched off while the VPN is on.
- Clear error messages based on Chrome's network error codes.
- English and Russian interface.

"VPN only in marked tabs", containers and routing by country exist only in the Firefox version: Chrome sets the proxy with a PAC script, which knows neither the tab nor the country of a site.

## Server requirements (direct mode)

- The server certificate must be trusted by Chrome. Let's Encrypt works out of the box. For a self-signed certificate click **Certificate** next to the server, then import the `.pem` at `chrome://certificate-manager` → Local certificates → Installed by you → Trusted certificates (or into the OS store, e.g. macOS Keychain → Always Trust).
- Connect by **domain name** (SNI must match `hosts.toml`), not by IP.
- `vpn.toml` must enable `[listen_protocols.http1]` or `[listen_protocols.http2]`, not only QUIC.
- Keep the default 407 auth failure response (`auth_failure_status_code`), otherwise Chrome cannot authenticate.

## Install

**Chrome Web Store:** coming soon.

**From source:** open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the `extension/` folder.

## SOCKS5 mode

Add a SOCKS listener **without username/password** (Chrome has no SOCKS authentication) to `trusttunnel_client.toml` and run the client:

```toml
[listener.socks]
address = "127.0.0.1:1080"
```

```bash
trusttunnel_client --config trusttunnel_client.toml
```

Then add a server in the extension with the **Via local trusttunnel_client (SOCKS5)** mode.

## Development

```
extension/                     the extension (Manifest V3, service worker) — edit here
scripts/build-zip.sh           pack extension/ into dist/trusttunnel-chrome-<version>.zip
scripts/test-config.js         self-test of the tt:// and TOML parsers (node scripts/test-config.js)
scripts/e2e.js                 end-to-end test against a local fake TrustTunnel server
scripts/e2e-live.js            end-to-end test against a live server (key read from a file, never stored)
scripts/store-screenshots.js   Chrome Web Store screenshots (store/screenshots/)
store/                         store listing texts and screenshots
```

The browser tests need `puppeteer-core` (`NODE_PATH=<dir>/node_modules`) and a Chromium that still
accepts `--load-extension` (Chromium, Chrome for Testing; branded Google Chrome 137+ does not).

The Firefox version is a separate project: [TrustTunnel-FireFox](https://github.com/BorisGB2001/TrustTunnel-FireFox).

## Privacy

No analytics or telemetry. Credentials stay in the local extension storage of your Chrome profile. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)

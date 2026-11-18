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

### Description (English)

TrustTunnel Browser Client connects Chrome to your own TrustTunnel server — the open-source VPN protocol by AdGuard. Only browser traffic goes through the tunnel; the rest of your system is untouched, and nothing needs to be installed besides the extension.

You need your own TrustTunnel server. This extension does not provide a VPN service.

Features
• Import a tt:// key, a trusttunnel_client.toml config or a server export — or enter the server manually
• Several servers, switchable from the toolbar
• Split tunneling: everything except a list, or only listed sites; domains, IPs and subnets
• Kill switch: if the server is down, traffic does not bypass the VPN
• WebRTC leak protection while the VPN is on
• Clear error messages: certificate, password, DNS, closed port
• Optional SOCKS5 mode for the official trusttunnel_client (HTTP/3, anti-DPI)
• English and Russian interface

How it works: TrustTunnel is HTTP CONNECT over TLS with Basic authentication, so Chrome talks to your server as to an HTTPS proxy. The server certificate must be trusted by Chrome (Let's Encrypt works out of the box; a self-signed certificate can be imported).

Privacy: no analytics, no telemetry, no data sent to the developer. Your server credentials are stored only in your Chrome profile.

Unofficial community project, not affiliated with AdGuard. Open source (MIT): https://github.com/BorisGB2001/TrustTunnel-Browser-Client

### Описание (русский)

TrustTunnel — клиент для браузера подключает Chrome к вашему собственному серверу TrustTunnel — открытому VPN-протоколу AdGuard. Через туннель идёт только трафик браузера, остальная система не затрагивается; ничего, кроме расширения, устанавливать не нужно.

Нужен собственный сервер TrustTunnel. Расширение не предоставляет VPN-сервис.

Возможности
• Импорт ключа tt://, конфига trusttunnel_client.toml или экспорта сервера — или ввод вручную
• Несколько серверов, переключение с панели браузера
• Раздельное туннелирование: всё, кроме списка, или только сайты из списка; домены, IP и подсети
• Kill switch: если сервер недоступен, трафик не идёт в обход VPN
• Защита от утечки IP через WebRTC, пока VPN включён
• Понятные ошибки: сертификат, пароль, DNS, закрытый порт
• Режим SOCKS5 для официального trusttunnel_client (HTTP/3, anti-DPI)
• Интерфейс на английском и русском

Как это работает: TrustTunnel — это HTTP CONNECT поверх TLS с Basic-авторизацией, поэтому Chrome работает с вашим сервером как с HTTPS-прокси. Chrome должен доверять сертификату сервера (Let's Encrypt — сразу, самоподписанный можно импортировать).

Приватность: без аналитики и телеметрии, разработчику ничего не отправляется. Логин и пароль хранятся только в профиле Chrome.

Неофициальный проект сообщества, не связан с AdGuard. Открытый код (MIT): https://github.com/BorisGB2001/TrustTunnel-Browser-Client

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

**storage**
Stores the user's server profiles (hostname, port, username, password, optional certificate) and settings (routing mode, site lists, kill switch) locally in chrome.storage.local, and the current connection status in chrome.storage.session.

**alarms**
Runs a connectivity check through the tunnel every 30 seconds while the VPN is on, to show the connection status and latency.

**privacy**
Sets chrome.privacy.network.webRTCIPHandlingPolicy to "disable_non_proxied_udp" while the VPN is on (optional setting), so WebRTC cannot leak the user's real IP address around the VPN. Restored when the VPN is turned off.

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

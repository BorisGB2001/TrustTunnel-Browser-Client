# TrustTunnel — клиент для браузера (Chrome)

Расширение Chrome: VPN-клиент для [TrustTunnel](https://github.com/TrustTunnel/TrustTunnel) — открытого VPN-протокола AdGuard — только для браузера. Через ваш сервер TrustTunnel идёт только трафик браузера, остальная система не затрагивается. Работает в Chrome 120+ и других браузерах на Chromium (Edge, Brave, Opera, Vivaldi).

[English version](README.md)

> Неофициальный проект сообщества, не связан с AdGuard.

## Как это работает

TrustTunnel — это HTTP `CONNECT` поверх TLS с Basic-авторизацией, то есть обычный **HTTPS-прокси** для Chrome. Помощник на компьютере не нужен.

- Расширение превращает правила маршрутизации в PAC-скрипт (`HTTPS host:port`) и включает его через `chrome.proxy.settings`.
- Chrome шлёт `CONNECT` без пароля, сервер отвечает `407`, расширение подставляет логин и пароль в `webRequest.onAuthRequired` для своей проверки связи, дальше Chrome сам использует их для всех страниц.
- У расширения **нет доступа к сайтам**: единственное разрешение на хост — `connectivitycheck.gstatic.com` для проверки связи.
- Каждые 30 секунд — проверка связи через туннель.

Для того, что браузер сам не умеет (сервер только с HTTP/3, anti-DPI, правила `client_random`), есть режим SOCKS5 через официальный [`trusttunnel_client`](https://github.com/TrustTunnel/TrustTunnelClient).

## Требования к серверу (режим «напрямую»)

- Chrome должен доверять сертификату сервера. С Let's Encrypt всё работает сразу. Для самоподписанного: кнопка «Сертификат» у сервера, затем `chrome://certificate-manager` → Локальные сертификаты → Установленные вами → Доверенные сертификаты → Импортировать (или «Связка ключей» macOS → «Всегда доверять»).
- Подключение по **доменному имени** (SNI должен совпадать с `hosts.toml`), не по IP.
- В `vpn.toml` включены `[listen_protocols.http1]` или `[listen_protocols.http2]`, не только QUIC.

## Установка

- **Chrome Web Store:** скоро.
- **Из исходников:** `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → папка `extension/`.
- **SOCKS5:** в `trusttunnel_client.toml` секция `[listener.socks]` с `address = "127.0.0.1:1080"` **без логина и пароля** (Chrome не умеет авторизацию SOCKS).

Версия для Firefox — отдельный проект [TrustTunnel-FireFox](https://github.com/BorisGB2001/TrustTunnel-FireFox).

## Разработка

Код правится прямо в `extension/`. Скрипты в `scripts/`: `build-zip.sh` (архив для магазина),
`test-config.js` (разбор tt:// и TOML), `e2e.js` (тест с локальным фейковым сервером),
`e2e-live.js` (тест с живым сервером, ключ читается из файла и не сохраняется),
`store-screenshots.js` (скриншоты для магазина). Браузерным тестам нужен `puppeteer-core`
и Chromium, который принимает `--load-extension`.

## Лицензия

[MIT](LICENSE)

# Privacy Policy — TrustTunnel Browser Client (Chrome)

Last updated: 2026-11-23

TrustTunnel Browser Client ("the extension") is an open-source Chrome extension that connects the browser to a TrustTunnel VPN server chosen by the user.

## Data the extension collects

None. The extension has no analytics, telemetry, crash reporting or advertising, and its developer receives no data from it.

## Data stored on your device

- Server profiles you add: name, hostname, port, username, password, optional server certificate, SOCKS5 settings.
- Settings: routing mode, site lists, kill switch and WebRTC options, the address of the "Statistics" page if you set one.

This data is kept in the extension's local storage inside your Chrome profile (`chrome.storage.local`). It is not synced and is deleted when you remove the server or uninstall the extension.

## Data sent over the network

- **To your TrustTunnel server** (the one you configured): your username and password (HTTP Basic proxy authentication) and the browser traffic you choose to route through the VPN. This server is operated by you or by whoever gave you the key, not by the extension developer.
- **Connectivity check**: every 30 seconds while the VPN is on, a request to `https://connectivitycheck.gstatic.com/generate_204` sent through your server, to measure whether the tunnel works.
- **"Check IP" button**: only when you click it, requests to `https://api.ipify.org` (through the VPN) and `https://api4.ipify.org` (directly) to show your external IP address with the VPN and without it.
- **Address details (off by default)**: if you click "Show country, provider and address type" and grant access to `proxycheck.io`, "Check IP" also sends these two IP addresses to `https://proxycheck.io` (through the VPN when it is on) to show their country, provider and type.
- **"Statistics" button**: opens the page whose address you entered in Settings in a new tab. The extension itself sends nothing there.

No other requests are made by the extension.

## Contact

Questions and issues: https://github.com/BorisGB2001/TrustTunnel-Browser-Client/issues

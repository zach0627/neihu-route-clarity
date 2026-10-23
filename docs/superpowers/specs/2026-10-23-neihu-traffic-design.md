# 內湖往內科早尖峰車流

User authorized implementation on 2026-10-23 after discussion and a one-day data audit.

Build a simple Traditional Chinese React application with a ranking page and an API / methodology page. Scope: road detector directions in Neihu District toward Neihu Technology Park; latest 30 calendar days ending 2026-10-22, excluding Saturday and Sunday; daily 07:00–09:30 Asia/Taipei. Use reported one-minute Volume counts by lane and vehicle type. Do not interpolate, extrapolate missing minutes, add successive detector counts, or present partial sums as complete totals. Show fewer than ten eligible directions when necessary.

Architecture: Node acquisition scripts download authenticated TDX historical static and dynamic data; secrets remain in ignored local environment files. Cache compressed original responses and sanitized provenance. A reproducible aggregation pipeline creates data/dashboard.json. React embeds that snapshot at build time. Vite builds one self-contained dist/index.html with all JS and CSS inline, which works over file:// with no local server, CDN, dynamic imports, or data fetch. Updating data requires running the Node pipeline and rebuilding; double-clicking the export shows the dated snapshot.

Alternatives considered: browser calling TDX directly exposes the secret and cannot update safely offline; serving a normal Vite bundle requires a local HTTP server for reliable module loading; the selected single HTML export meets double-click use while a local Node update command handles authenticated data collection.

Quality: accept a direction-minute only if Status=0, its dynamic link and lane count match same-day static LaneNum, lane IDs are unique, all volumes are nonnegative numbers, and all lane ErrorDiags are diag0. Require all 150 expected timestamp minutes per analyzed day. Monthly comparisons use the same dates for every ranked direction. Report requested versus downloaded dates and failed downloads. A partial snapshot must never be labeled a complete month.

Time convention: explicitly use 07:00 <= DataCollectTime < 09:30 after conversion to Asia/Taipei. Official start/end interval semantics remain unconfirmed; explain this boundary limitation in the app. Volume is a one-minute count under the official standard.

Geography: use historical TownName=內湖區. Keep curated directional scope rules with evidence and confidence. Any inferred direction is labeled provisional, with its reasoning visible; do not claim destination tracking. One representative VD per repeated LinkID; never sum serial stations. Allow the UI to inspect all exclusions.

Method page: exact API URLs and parameters, authentication architecture without credentials, provenance dates and hashes, actual static and dynamic samples, calculation example from the same record, time and weekday filter, quality and deduplication rules, geographic assumptions, limitations, and offline update instructions. Include CSV/JSON export of derived public results.

Verification: meaningful unit tests for interval and weekday boundaries, strict quality checks, duplicate/conflicting records, consistent-date ranking, and duplicate LinkID selection. Browser tests must open the built file:// HTML, verify both pages and data, and confirm it makes no network calls during offline use. Inspect responsive layout.

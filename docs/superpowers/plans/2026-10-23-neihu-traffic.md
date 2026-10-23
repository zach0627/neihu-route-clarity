# Neihu Traffic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver a React vehicle-flow ranking with auditable TDX methodology and a self-contained double-click HTML export.

**Architecture:** Authenticated Node scripts cache TDX historical records and create an embedded JSON snapshot. React renders ranks and provenance; Vite inlines the production bundle for file:// opening.

**Tech Stack:** Node 24, React, Vite, vanilla CSS, Node test runner, Playwright verification.

**Spec:** docs/superpowers/specs/2026-10-23-neihu-traffic-design.md

## Global Constraints

- 07:00–09:30 Asia/Taipei; exclude Saturday and Sunday.
- No fabricated flow, imputation, or serial-detector sum.
- Every rank uses identical analyzed dates and all 150 valid minutes per day.
- No secrets in source control, browser bundles, logs, exports, or manifests.
- dist/index.html must work directly over file:// and without network.

## Review Focus

- Missing months or failed dates must show partial coverage.
- Conflicting duplicates invalidate affected observations.
- A zero accepted sum must not be described as zero measured traffic.
- Unverified destination direction and time boundary must be visible.
- Repeated LinkID must not produce double counting.

### Task 1: Data pipeline and scientific checks

Files: lib/ranking.mjs, scripts/aggregate.mjs, tests/data.test.mjs, data/dashboard.json.
Interfaces: export buildRankings(directions, dates, options?) and analyzeRecord(record, staticVD); aggregation CLI reads cached research/data sources and config/directions.json.
- [x] Write and run meaningful boundary, quality, duplicate, and comparability tests.
- [x] Implement static/dynamic parsing and strict one-minute acceptance.
- [x] Produce a JSON snapshot with requested/available dates, source provenance, daily results, and real examples.

### Task 2: Directional scope

Files: config/directions.json, docs/directional-scope.md.
- [x] Use historical static coordinates and official park geography to curate included/excluded/provisional directions.
- [x] Define a repeatable representative VD rule for repeated LinkID.
- [x] Keep uncertainties and the rationale visible in snapshot data.

### Task 3: React experience

Files: src/App.jsx, src/styles.css, src/main.jsx.
Interfaces: import data/dashboard.json and buildRankings from lib/ranking.mjs. Snapshot top-level keys: meta, coverage, summary, directions, rankings, dailyStats, sources, sample.
- [x] Build responsive ranking with data dates, strict eligibility and explanations, direction details, date filters, CSV/JSON export.
- [x] Build API and calculation page with real source examples and offline update guidance.

### Task 4: Acquisition and standalone build

Files: package.json, vite.config.js, index.html, scripts/download.mjs, scripts/standalone.mjs, .gitignore, .env.example, README.md.
- [x] Implement credential-safe historical download with cache, streaming, throttling, sanitized errors, and manifests.
- [x] Attempt all 22 requested working days, resuming cached 2026-10-22 data; cache 21 usable dates and preserve the 2026-09-24 stale/missing target-window failure.
- [x] Build a single inline HTML with embedded snapshot, CSS and classic JS.

### Task 5: End-to-end verification

Files: tests/offline.spec.mjs, screenshots in artifacts/.
- [x] Run data tests and production build.
- [x] Open dist/index.html over file://, exercise navigation and exports, assert no external requests and no secrets.
- [x] Inspect desktop/mobile screenshots and resolve functional/layout issues.
- [x] Document exact commands, actual coverage, and remaining data limitations.

The user explicitly requested implementation; execute in the current chat with parallel agents without another approval pause.

## Delivered data limitations

21/22 requested dates are usable; 2026-09-24 returned no target-window Neihu records and was excluded. No direction is complete on every available date. Directional scope remains a published proposal; timestamp interval-boundary semantics remain explicitly unconfirmed.

## User-authorized comparison update

The user explicitly requested ranking the currently available valid observations and explaining incompleteness on the validation page. The primary ranking now uses measured accepted Volume divided by accepted minutes, with no imputation, zero-filling, or multiplication to a complete morning. All 23 predetermined representative directions with valid observations can participate; the first ten are displayed and exported. The original strict-complete calculation remains a separate diagnostic (0 qualifying directions), rather than blocking the main ranking.

- [x] Add observed-minute mean ranking and tests for unequal observed exposure, real zero counts and stable representatives.
- [x] Regenerate the source snapshot with ten real ranking rows and compare every number to the independent analysis.
- [x] Explain different sampled timestamps, potential missing-peak bias, and both 3,150 available-day and 3,300 requested-period minute denominators.
- [x] Rebuild the standalone HTML and verify ten actual rows and CSV export offline on desktop and mobile.

Final verification: 30 unit/integration checks passed; actual standalone HTML and a synthetic unequal-exposure fixture passed offline browser checks. A share ZIP containing only `dist/index.html` was extracted into a different folder with Chinese characters and spaces, then opened via `file://` in fresh desktop/mobile Chrome contexts: ten rows and both pages rendered with zero HTTP requests or runtime errors. Exact scans against both local credential values passed.

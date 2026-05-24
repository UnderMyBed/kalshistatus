# Changelog

## [1.2.0](https://github.com/UnderMyBed/kalshistatus/compare/v1.1.0...v1.2.0) (2026-05-24)


### Features

* uptime % in banner, 24h latency chart, extract CSS to /style.css ([#33](https://github.com/UnderMyBed/kalshistatus/issues/33)) ([468a29e](https://github.com/UnderMyBed/kalshistatus/commit/468a29e793b7e8afab3c5064dae3382af159f72f))

## [1.1.0](https://github.com/UnderMyBed/kalshistatus/compare/v1.0.0...v1.1.0) (2026-05-24)

### Features

- expand colo map + region probe from fetch requests ([#26](https://github.com/UnderMyBed/kalshistatus/issues/26)) ([72f003d](https://github.com/UnderMyBed/kalshistatus/commit/72f003d728d6c2f075eec7863dbbe0c9684e3428))
- grafana-init endpoint, fix token name, CI dashboard sync ([#20](https://github.com/UnderMyBed/kalshistatus/issues/20)) ([7625044](https://github.com/UnderMyBed/kalshistatus/commit/762504489009d743ae6f7e2624943b5c586923a2))
- multi-region probing (Phase 6) ([b4b1d19](https://github.com/UnderMyBed/kalshistatus/commit/b4b1d19be16de6c583885fe4f18a274ff064b2e3))
- populate region probes from HTTP request edge datacenter ([#25](https://github.com/UnderMyBed/kalshistatus/issues/25)) ([e218562](https://github.com/UnderMyBed/kalshistatus/commit/e2185626e91da2c1305ece90aee9e052a7f2695a))
- set public Grafana dashboard URL ([#24](https://github.com/UnderMyBed/kalshistatus/issues/24)) ([da24e8d](https://github.com/UnderMyBed/kalshistatus/commit/da24e8df093b8aa523676a09258d55d30bf3c4d9))
- wire missing routes, fix frontend bugs, unify status palette ([#31](https://github.com/UnderMyBed/kalshistatus/issues/31)) ([c359b80](https://github.com/UnderMyBed/kalshistatus/commit/c359b802d9f18b248456a7b53dafd085d16019ea))

### Bug Fixes

- **ci:** disable remote bindings; pass null body for 204/304 responses ([#30](https://github.com/UnderMyBed/kalshistatus/issues/30)) ([2516c41](https://github.com/UnderMyBed/kalshistatus/commit/2516c41cf5f61b0c0ca5613cf05cb33114768583))
- custom domain routes and CHANGELOG formatting ([#16](https://github.com/UnderMyBed/kalshistatus/issues/16)) ([3e65005](https://github.com/UnderMyBed/kalshistatus/commit/3e65005f4072e3fd3cf344c5d0d28aed5512e59f))
- extend region probe window to 60 minutes ([#28](https://github.com/UnderMyBed/kalshistatus/issues/28)) ([ed2af70](https://github.com/UnderMyBed/kalshistatus/commit/ed2af70c70f2b355bbce49c22e6786b7fe6eabcf))
- foundation hardening — status logic, security headers, deps, workflows ([#29](https://github.com/UnderMyBed/kalshistatus/issues/29)) ([c78faaf](https://github.com/UnderMyBed/kalshistatus/commit/c78faafa705015a3a553fd1d338f68d91f3b501d))
- remove invalid secrets context from workflow if condition ([#22](https://github.com/UnderMyBed/kalshistatus/issues/22)) ([ccb866c](https://github.com/UnderMyBed/kalshistatus/commit/ccb866c2073eab20276954856732f65b07487115))
- widen region probe recency window from 2 to 10 minutes ([#27](https://github.com/UnderMyBed/kalshistatus/issues/27)) ([36d22fc](https://github.com/UnderMyBed/kalshistatus/commit/36d22fc4355ad7f2c69abfd2f27de17866f10b5d))

### Performance Improvements

- edge cache hot routes, dedupe exchange fetch, region probe history ([#32](https://github.com/UnderMyBed/kalshistatus/issues/32)) ([c36c9b3](https://github.com/UnderMyBed/kalshistatus/commit/c36c9b391f0326126664d1797df92648d5171c3e))

## 1.0.0 (2026-05-24)

### Features

- **api:** REST API routes — /api/status, /api/history, /badge.svg (Phase 6) ([#7](https://github.com/UnderMyBed/kalshistatus/issues/7)) ([368fe96](https://github.com/UnderMyBed/kalshistatus/commit/368fe966f970d38e8ea7dcf179eb35f8c3b6fae1))
- **changelog:** Workers AI changelog summarization ([#8](https://github.com/UnderMyBed/kalshistatus/issues/8)) ([e37335e](https://github.com/UnderMyBed/kalshistatus/commit/e37335e25768a970d54862c87e5e6322bc1cba20))
- **cron:** KV write-on-change and cron orchestration (Phase 5) ([#6](https://github.com/UnderMyBed/kalshistatus/issues/6)) ([681a8fe](https://github.com/UnderMyBed/kalshistatus/commit/681a8fecc7eb583fd64ef7128883060e554f245a))
- D1 snapshot persistence with save, load-latest, and prune ([#5](https://github.com/UnderMyBed/kalshistatus/issues/5)) ([eb9ed80](https://github.com/UnderMyBed/kalshistatus/commit/eb9ed8009bdbda7a6c86ec09fc262419c992fd00))
- **dashboard:** Phase 10 — static dashboard with history view ([#11](https://github.com/UnderMyBed/kalshistatus/issues/11)) ([6f9c36b](https://github.com/UnderMyBed/kalshistatus/commit/6f9c36b1ed847f85d24f0ab8e97272cef183b365))
- embed widget for iframe integration ([#14](https://github.com/UnderMyBed/kalshistatus/issues/14)) ([5fd1532](https://github.com/UnderMyBed/kalshistatus/commit/5fd1532c9696d35a7557b896ea32b9f2b0a4c311))
- Grafana Cloud Prometheus metrics push ([#13](https://github.com/UnderMyBed/kalshistatus/issues/13)) ([cb147bf](https://github.com/UnderMyBed/kalshistatus/commit/cb147bfe1b81bc505f4536e6b4fdfee8b73933c2))
- Kalshi REST client with RSA-PSS auth signing ([#3](https://github.com/UnderMyBed/kalshistatus/issues/3)) ([57095fa](https://github.com/UnderMyBed/kalshistatus/commit/57095fa8e924e17f98db8ae723862b10501b5e57))
- runtime cost circuit breaker ([#10](https://github.com/UnderMyBed/kalshistatus/issues/10)) ([4d5852a](https://github.com/UnderMyBed/kalshistatus/commit/4d5852abf93141d684708da7cd7f5069c6cda8f5))
- status determination and exchange status extraction ([#4](https://github.com/UnderMyBed/kalshistatus/issues/4)) ([ccb4d90](https://github.com/UnderMyBed/kalshistatus/commit/ccb4d90688784a67902c0fa3c33cad509fa832e0))
- worker scaffold, CI/CD, and storage bindings ([#2](https://github.com/UnderMyBed/kalshistatus/issues/2)) ([cc0a159](https://github.com/UnderMyBed/kalshistatus/commit/cc0a1591901997dbecae2b61f98d3ea5ac6bfe5b))
- **ws:** WebSocket tick sampler ([#9](https://github.com/UnderMyBed/kalshistatus/issues/9)) ([f7ee9f3](https://github.com/UnderMyBed/kalshistatus/commit/f7ee9f3d4075cd267f03156ff5a8475f37a5d55d))

# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti Keep a Changelog, versi mengikuti SemVer.

## [Unreleased]

### Added
- Replay dua panel setelah ronde: gerakanmu ("you") dan pro diputar berdampingan.
- Score card PNG yang bisa diunduh, dengan QR berisi tautan tantangan (`/#c=…`) untuk mengajak orang lain memainkan ronde yang sama.
- Peta orisinal Cistern untuk level lotus, plus 3 level lotus di playlist (total 6: 3 haven di Kiln + 3 lotus di Cistern).
- Pipeline build publik `pnpm -C web build:public`: menyalin hanya level featured ke `public/levels/`, gagal bila level hilang, playlist > 6, atau data kalibrasi ikut terbawa, lalu memeriksa isi `dist/`.
- Konfigurasi Vercel (`web/vercel.json`) dan panduan deploy prebuilt di `docs/deploy.md`.
- Header keamanan untuk deploy publik: CSP ketat (`script-src 'self'` tanpa `unsafe-eval`, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; `vite preview` memakai header yang sama.
- Favicon SVG orisinal (`web/public/favicon.svg`), sehingga `/favicon.ico` tidak lagi 404 di browser.
- Catatan orisinalitas peta Cistern di `README.md`: geometri orisinal, layout di-warp dari densitas posisi pemain agregat, tanpa art/geometri peta Riot.
- Link previews: Open Graph and Twitter `summary_large_image` meta tags in `web/index.html` plus an original 1200x630 card `web/public/og-image.png` (drawn by `pnpm -C web og-image`, no dependencies). Challenge links (`/#c=…`) share the same card because the fragment never reaches crawlers; the CSP is unchanged.
- Booth kiosk mode (`?kiosk=1`, optional `&idle=<s>`, 10–600 s, default 60 s): after initials are saved the score screen returns to the level select after 15 s without input (hard cap 60 s); an untouched level select switches to an attract loop (featured rounds + top scores) whose first key/click only dismisses it; "Download card" is hidden and `#c=` challenge links are ignored (the QR stays); the operator can clear the local leaderboard with Ctrl+Shift+Alt+R or 5 quick taps in the top-left corner, followed by an in-page confirm. Normal mode and gameplay rules are unchanged.

### Changed
- Level schema v2: level files, `featured.json` and `data/levels/<map>/` use the original map ids `kiln` / `cistern` instead of the source map names; exported levels no longer carry weapon names, armor, raw GRID `x`/`y` or `killerUV` (only fields the client reads). The web loader accepts v2 only; `uv run relive-migrate-levels` converts existing v1 exports without the GRID feeds. The dev density raster is now `data/calib/<map id>-density.json`.
- Playlist level kini dibaca dari `web/src/game/featured.json`, satu sumber untuk game, test, dan script build.
- Build publik (`VITE_REQUIRE_LEVELS=1`) menampilkan error bila level gagal dimuat, tidak lagi diam-diam memakai level sintetis; mode dev tetap memakai fallback (kini per slot: slot lotus memakai Cistern dan id unik).
- Halaman debug (`?debug`) hanya ada di build dev; tidak ikut bundel produksi.

### Fixed
- Batas waktu replay (45 s) kembali ke layar skor, bukan ke attract, sehingga skor yang belum disimpan tidak hilang.
- Menahan Enter pada tombol "Watch replay"/"Beat this" tidak lagi memicu klik berulang.

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

### Changed
- Playlist level kini dibaca dari `web/src/game/featured.json`, satu sumber untuk game, test, dan script build.
- Build publik (`VITE_REQUIRE_LEVELS=1`) menampilkan error bila level gagal dimuat, tidak lagi diam-diam memakai level sintetis; mode dev tetap memakai fallback (kini per slot: slot lotus memakai Cistern dan id unik).
- Halaman debug (`?debug`) hanya ada di build dev; tidak ikut bundel produksi.

### Fixed
- Batas waktu replay (45 s) kembali ke layar skor, bukan ke attract, sehingga skor yang belum disimpan tidak hilang.
- Menahan Enter pada tombol "Watch replay"/"Beat this" tidak lagi memicu klik berulang.

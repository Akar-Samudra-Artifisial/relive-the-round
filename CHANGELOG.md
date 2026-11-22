# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti Keep a Changelog, versi mengikuti SemVer.

## [Unreleased]

### Added
- Character art: actors are drawn as 3D character models (`operator-rifle.glb`, `enemy.glb`) in the 3D renderer and as top-down sprites in 2D, with procedural motion (turning to the aim/facing or movement direction, footstep bob, forward lean, a 400 ms fall for downs; snapped under `prefers-reduced-motion`). The cylinders/circles stay as the fallback while the assets load or when they fail to load.
- 3D renderer (three.js, lazy chunk): a tilted 3D view of the map with actors, tracers and the spike, the two-panel replay in 3D, quality tiers (shadows on the top tier, `?quality=high|medium|low`, phones start at medium), an FPS watchdog that steps the tier down, and an automatic fallback to the 2D renderer when WebGL2 is missing or fails. Details in `docs/3d-renderer.md`.
- Experimental 3D renderer, phase 0: `?3d=1` lazily loads a three.js probe chunk (exact `three` 0.187.0) that logs `{ revision, webgl2 }` to the console; without the param the probe chunk is not downloaded. Sizes in `docs/3d-renderer.md`.
- Touch controls for phones: a twin-stick overlay on the play screen (left stick moves, right stick aims and fires past 70 % tilt) plus a hold-to-use DEFUSE button that appears only in spike range. It turns on for coarse pointers or the first touch, hides again on keyboard/mouse input, and can be pinned with `?touch=1`. Portrait phones get the controls below the map, landscape phones get translucent corner pads. Touch hints replace "hold E". Desktop controls are unchanged. Holding DEFUSE suppresses touch fire so a resting thumb cannot cancel the defuse (keyboard/mouse unchanged); the compact landscape layout applies only in touch mode, so short desktop windows keep the regular HUD.
- Replay dua panel setelah ronde: gerakanmu ("you") dan pro diputar berdampingan.
- Score card PNG yang bisa diunduh, dengan QR berisi tautan tantangan (`/#c=…`) untuk mengajak orang lain memainkan ronde yang sama.
- Peta orisinal Cistern untuk level lotus, plus 3 level lotus di playlist (total 6: 3 haven di Kiln + 3 lotus di Cistern).
- Pipeline build publik `pnpm -C web build:public`: menyalin hanya level featured ke `public/levels/`, gagal bila level hilang, playlist > 6, atau data kalibrasi ikut terbawa, lalu memeriksa isi `dist/`.
- Konfigurasi Vercel (`web/vercel.json`) dan panduan deploy prebuilt di `docs/deploy.md`.
- Header keamanan untuk deploy publik: CSP ketat (`script-src 'self'` tanpa `unsafe-eval`, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; `vite preview` memakai header yang sama.
- Favicon SVG orisinal (`web/public/favicon.svg`), sehingga `/favicon.ico` tidak lagi 404 di browser.
- Catatan orisinalitas peta Cistern di `README.md`: geometri orisinal, layout di-warp dari densitas posisi pemain agregat, tanpa art/geometri peta Riot.
- Link previews: Open Graph and Twitter `summary_large_image` meta tags in `web/index.html` plus an original 1200x630 card `web/public/og-image.png` (drawn by `pnpm -C web og-image`, no dependencies). Challenge links (`/#c=…`) share the same card because the fragment never reaches crawlers; the CSP is unchanged.
- `AI_SHOWCASE.md` and `docs/ai-showcase/`: the Junie (WebStorm) workflow, with five sessions exported from the local Junie logs (prompt, plan, commands and results, human corrections, commit). The Tooling section in `docs/devpost-submission.md` now names the JetBrains tools used.
- Booth kiosk mode (`?kiosk=1`, optional `&idle=<s>`, 10–600 s, default 60 s): after initials are saved the score screen returns to the level select after 15 s without input (hard cap 60 s); an untouched level select switches to an attract loop (featured rounds + top scores) whose first key/click only dismisses it; "Download card" is hidden and `#c=` challenge links are ignored (the QR stays); the operator can clear the local leaderboard with Ctrl+Shift+Alt+R or 5 quick taps in the top-left corner, followed by an in-page confirm. Normal mode and gameplay rules are unchanged.

### Changed
- In the two-panel replay the PRO clutcher's body (glow, aim and player-side downs) is amber, matching the PRO panel accent; it was cyan in both panels.
- The 3D renderer is now the default when WebGL2 is available; `?2d=1` (or `?3d=0`) forces the Pixi 2D renderer, and browsers without WebGL2 keep 2D silently.
- Tampilan DOM bergaya "tactical HUD" gelap: design system di `web/src/ui/theme.css` (token warna/spasi/bevel, font self-hosted Chakra Petch + JetBrains Mono, OFL) dan token TS di `web/src/ui/theme.ts`. Semua layar memakai gaya ini: level select dengan kartu bergambar per peta, banner tantangan, attract loop kiosk, HUD, countdown, replay bar, layar skor, leaderboard, dan panel reset kiosk. Layout kini responsif dari ponsel portrait sampai 1080p, focus terlihat untuk keyboard, dan animasi dimatikan saat `prefers-reduced-motion`.
- Logo SVG baru (crosshair dengan panah replay) di menu dan favicon. Latar menu dan thumbnail peta Kiln/Cistern dibuat via Runware dan disimpan lokal di `web/public/assets/` (asal-usul di `docs/assets.md`).
- Canvas mengecil mengikuti lebar layar sempit; posisi aim mouse/pointer dikonversi ke piksel canvas sehingga tetap akurat.
- Canvas game, replay, dan debug kini tajam di layar HiDPI/HP. Pixi merender sesuai `devicePixelRatio` (maksimal 2) dengan `autoDensity`, jadi ukuran tampilan tidak berubah. Teks canvas ikut resolusi renderer. Konversi pointer memakai ukuran logis (`app.screen`), bukan `canvas.width`, sehingga aim tetap tepat. Label spawn di peta punya ukuran minimum sekitar 10 px CSS agar terbaca di layar kecil.
- Render peta dan aktor kini bergaya tactical HUD dengan token `web/src/ui/theme.ts`. Peta: lantai gelap bergrid, dinding solid bertepi cyan, situs ber-tint amber dengan garis putus-putus dan bracket sudut, zona spawn ATK/DEF dibedakan, label pakai Chakra Petch. Aktor digambar lewat modul bersama `web/src/render/actors.ts`: pemain cyan dengan glow dan cone bidik, musuh merah dengan cone pandang, tracer dengan efek hit, spike berbentuk berlian dengan cincin progres defuse (hijau untukmu, merah untuk musuh). Pulse spike mati saat `prefers-reduced-motion`. Font dimuat dulu sebelum teks canvas dirender.
- Replay dua panel memakai header HUD (YOU cyan, PRO amber) dan bingkai peta. Ukuran panel kini dihitung dari viewport, dikurangi tinggi kontrol replay: berdampingan di layar lebar, ditumpuk vertikal di ponsel portrait. Panel dan kontrol ditengahkan vertikal, dan kontrol tetap terlihat tanpa scroll.
- Score card PNG dan `og-image.png` didesain ulang dengan palet, tipografi, dan logo baru. QR tetap hitam-putih murni dengan quiet zone 4 modul.
- Level schema v2: level files, `featured.json` and `data/levels/<map>/` use the original map ids `kiln` / `cistern` instead of the source map names; exported levels no longer carry weapon names, armor, raw GRID `x`/`y` or `killerUV` (only fields the client reads). The web loader accepts v2 only; `uv run relive-migrate-levels` converts existing v1 exports without the GRID feeds. The dev density raster is now `data/calib/<map id>-density.json`.
- Playlist level kini dibaca dari `web/src/game/featured.json`, satu sumber untuk game, test, dan script build.
- Build publik (`VITE_REQUIRE_LEVELS=1`) menampilkan error bila level gagal dimuat, tidak lagi diam-diam memakai level sintetis; mode dev tetap memakai fallback (kini per slot: slot lotus memakai Cistern dan id unik).
- Halaman debug (`?debug`) hanya ada di build dev; tidak ikut bundel produksi.

### Fixed
- Garis bidik tidak lagi tergambar dari pojok kiri-atas canvas sebelum pointer pernah digerakkan atau ditekan di canvas.
- Batas waktu replay (45 s) kembali ke layar skor, bukan ke attract, sehingga skor yang belum disimpan tidak hilang.
- Menahan Enter pada tombol "Watch replay"/"Beat this" tidak lagi memicu klik berulang.

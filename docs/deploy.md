# Public deploy (Vercel, prebuilt)

The level files are derived from licensed GRID data, are git-ignored, and exist only on the
build machine. Vercel therefore never builds from source: we build locally with `vercel build`
and upload the output with `vercel deploy --prebuilt`. Do **not** connect a Git repository to
the Vercel project (a Git build would have no levels and the repo must not hold the data).

## What ships

- `web/src/game/featured.json` — the playlist (max 6): 3 haven levels (Kiln) + 3 lotus levels (Cistern).
- `pnpm -C web build:public` runs:
  1. `scripts/prepare-public.mjs` — empties `web/public/levels/`, copies the featured files from
     `data/levels/<map>/`; fails on a missing file, more than 6 entries, or an existing `web/public/calib/`.
  2. `VITE_REQUIRE_LEVELS=1 pnpm build` — a level that fails to load throws instead of falling back
     to the synthetic fixture.
  3. `scripts/verify-dist.mjs` — `dist/index.html` must exist and `dist/levels/` must equal the
     playlist; `dist/` must not contain `calib/`, `.parquet`, `.zst`, `.jsonl`, the string `/Users/`,
     UUIDs (raw GRID ids), e-mail addresses, the dev probe `__rtr`, or debug-page code.

`web/vercel.json` sets framework `vite`, output `dist`, build command `pnpm build:public`, and
`git.deploymentEnabled: false`. No SPA rewrite is needed: challenge links use the URL hash (`/#c=…`).

## Security headers

`web/vercel.json` → `headers` applies to every path (`/(.*)`):

- `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'`
  - No `'unsafe-eval'`: `src/main.ts` imports `pixi.js/unsafe-eval`, which replaces Pixi's
    `new Function` shader/uniform code paths. Without that import Pixi refuses to start under this CSP.
  - `img-src data: blob:` covers the score-card PNG download (`URL.createObjectURL`);
    `worker-src blob:` covers Pixi's inline image-bitmap worker.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

`vite preview` does not read `vercel.json`, so `web/vite.config.mjs` copies the same headers into
`preview.headers`. Test locally with `pnpm build:public && pnpm preview`, then play a round, check the
QR, the replay and the card download with the browser console open: there must be no CSP violation.
(`vite dev` deliberately runs without the CSP.)

## Environment

- `VITE_PUBLIC_URL` (optional) — base URL encoded in share links and the score-card QR. Leave it
  unset on Vercel: the app then uses `location.origin`, which is the deployment URL. Set it only to
  force a stable alias, e.g. in the project's Preview env or inline: `VITE_PUBLIC_URL=https://… vercel build`.
- `.vercel/` (project link, pulled env, build output) is git-ignored.

## Steps (preview first, personal scope)

Run everything from `web/` with the data present in `../data/levels/`.

```sh
cd web
pnpm build:public                        # sanity check: must end with "verify-dist: OK (6 level(s)…)"
vercel link                              # interactive; pick the personal scope.
                                         # Answer NO to "Connect this Git repository…?".
                                         # Do not use --yes: it auto-connects the Git remote.
vercel pull --environment=preview        # project settings + Preview env into .vercel/
vercel build                             # runs `pnpm build:public`, writes .vercel/output
vercel deploy --prebuilt                 # uploads .vercel/output as a Preview deployment
```

Check the preview URL: the playlist shows 6 rounds, none labelled "(synthetic)", and
`<url>/levels/1273a6914b4e.json` returns 200.

Production (only after the preview is approved): repeat with the production target, because a
prebuilt output is tied to the environment it was built for.

```sh
vercel pull --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

If `vercel project` / dashboard ever shows a connected Git repository, disconnect it
(`vercel git disconnect`).

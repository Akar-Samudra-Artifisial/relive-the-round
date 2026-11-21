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

- `VITE_PUBLIC_URL` — base URL encoded in share links and the score-card QR. If unset, the app
  uses `location.origin` (the deployment URL). The project's **Production** env sets it to
  `https://relive-the-round.vercel.app`, so it only reaches the bundle when you run
  `vercel pull --environment=production` before `vercel build --prod`.
- `.vercel/` (project link, pulled env, build output) is git-ignored.

## Project

- Scope: the Hobby account `kaktua` (a Hobby "team" is a personal account; it cannot have members).
- Project: `relive-the-round`, no Git integration. Production alias: `https://relive-the-round.vercel.app`.

## Steps

Run everything from `web/` with the data present in `../data/levels/`.

First-time link (already done; only needed on a fresh checkout):

```sh
cd web
vercel link --scope kaktua               # interactive. Answer NO to "Connect this Git repository…?".
                                         # Do not use --yes: it auto-connects the Git remote.
```

Preview:

```sh
pnpm build:public                        # sanity check: must end with "verify-dist: OK (6 level(s)…)"
vercel pull --yes --environment=preview  # project settings + Preview env into .vercel/
vercel build                             # runs `pnpm build:public`, writes .vercel/output
vercel deploy --prebuilt --target=preview
```

Always pass `--target=preview`: the very first `vercel deploy --prebuilt` of this project landed
on production. Confirm with `vercel inspect <deployment-id>` (`target preview`).

Check the preview URL: the playlist shows 6 rounds, none labelled "(synthetic)", and
`<url>/levels/1273a6914b4e.json` returns 200.

Production: repeat with the production target, because a prebuilt output is tied to the
environment it was built for.

```sh
vercel pull --yes --environment=production   # required: brings in VITE_PUBLIC_URL
vercel build --prod
vercel deploy --prebuilt --prod
```

Check that the live site serves the new bundle: the `assets/index-*.js` name in
`curl -s https://relive-the-round.vercel.app/` matches `.vercel/output/static/assets/`.

If `vercel project` / dashboard ever shows a connected Git repository, disconnect it
(`vercel git disconnect`).

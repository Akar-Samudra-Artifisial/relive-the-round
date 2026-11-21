# Junie session 04: link previews (Open Graph / Twitter card)

| Field | Value |
|---|---|
| Session id | `session-261121-235502-1au4` |
| Junie task name | "Add Social Preview Metadata and Image Without CSP Breakage" (`summary.json`) |
| Session created | 2026-11-21 23:55 (UTC+8) |
| Prompt timestamp (`history.jsonl`) | 2026-11-22 00:04:13 (UTC+8) |
| IDE | WebStorm 2026.3 (build WS-263.7307.202), Junie plugin 263.2144.30, Junie agent 4100.10.0 |
| Model | `claude-opus-5-5`, effort `medium` (`settings.json`); helper models listed in `summary.json`: `gemini-3.1-flash-lite`, `gpt-6-luna`, `claude-haiku-5-5` |
| Outcome | Committed in `420dbdc` |

## Prompt

Verbatim. The prompt is cut off after "web/vercel.j" in both `history.jsonl` and `transcript.md`, and it is reproduced here as recorded:

> Add Open Graph and Twitter card meta tags to web/index.html and an original 1200x630 preview image in web/public, so shared links (including /#c=... score card links) render a proper preview. It must not break the CSP in web/vercel.j

## Junie's plan

No Plan mode. Junie's stated approach (verbatim "Thinking" entries):

> I'll start by reading the page template, the hosting config with its security policy, and the public build scripts to see how a preview image would fit in.

> I've settled on writing the CHANGELOG entry in English and generating a 1200x630 PNG for the social preview with a small dependency-free Node script, since SVG and system image tools aren't reliable for crawlers. Next I'll write the image script, then add the meta tags to index.html and a test that checks them.

Before deciding, it checked which image tools were available:

> ### Ran cat public/favicon.svg; ls tests; which magick convert rsvg-convert sips; python3 -c "import PIL; print(PIL.__version__)"; [...]

## What Junie did

| File | Change |
|---|---|
| `web/scripts/make-og-image.mjs` (new) | +215, a dependency-free PNG generator |
| `web/package.json` | +1 script `"og-image": "node scripts/make-og-image.mjs"` |
| `web/public/og-image.png` (new) | 1200x630 image produced by the script |
| `web/index.html` | +18 meta tags |
| `web/tests/social-meta.test.ts` (new) | +53 |
| `CHANGELOG.md` | +1 |

First attempt failed because the npm script did not exist yet:

```text
### Failed to run pnpm og-image && file public/og-image.png && shasum public/og-image.png && pnpm og-image >/dev/null && shasum public/og-image.png
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "og-image" not found
```

After the user approved the `package.json` edit, Junie checked that the image is valid and that the script produces the same file on every run (two identical checksums):

```text
### Ran pnpm og-image && file public/og-image.png && shasum public/og-image.png && node scripts/make-og-image.mjs >/dev/null && shasum public/og-image.png
make-og-image: wrote public/og-image.png (1200x630, 20115 bytes)
public/og-image.png: PNG image data, 1200 x 630, 8-bit/color RGB, non-interlaced
c67619a695583d3a3a309999d40747358c0f66e6  public/og-image.png
c67619a695583d3a3a309999d40747358c0f66e6  public/og-image.png
```

Junie then opened the PNG to inspect it (`### Read web/public/og-image.png`) before writing the meta tags.

Tests and type check (some lines omitted):

```text
### Ran pnpm test 2>&1 | tail -20; npx tsc --noEmit && echo TSC_OK
[...]
 Test Files  10 passed (10)
      Tests  112 passed (112)
TSC_OK
```

Build check: the image is copied to `dist/`, the tags survive the build, and git does not ignore the image:

```text
### Ran pnpm build 2>&1 | tail -4; file dist/og-image.png; grep -c 'og:\|twitter:' dist/index.html; git -C .. status --short; git -C .. check-ignore -v web/public/og-image.png || echo NOT_IGNORED
✓ built in 163ms
dist/og-image.png: PNG image data, 1200 x 630, 8-bit/color RGB, non-interlaced
15
[...]
NOT_IGNORED
```

CHANGELOG entry (verbatim diff line):

```diff
+- Link previews: Open Graph and Twitter `summary_large_image` meta tags in `web/index.html` plus an original 1200x630 card `web/public/og-image.png` (drawn by `pnpm -C web og-image`, no dependencies). Challenge links (`/#c=…`) share the same card because the fragment never reaches crawlers; the CSP is unchanged.
```

## Human review & corrections

- **Edit approval.** After the failed `pnpm og-image` run, Junie asked to edit `web/package.json` (an `ApproveEditFileData` request in `events.jsonl`). The user answered "Yes" (`## User response`).
- **Limits Junie surfaced** (task result, "Notes"):

> Every challenge link shows the same generic card. The `#c=…` part of the link never reaches crawlers, so a per-score preview would need server-side rendering.
> The image only appears in previews after the next deploy; I did not deploy.

- The transcript has no other user corrections.

## Outcome

Committed in `420dbdc`, "feat: add kiosk mode, level schema v2 and link previews". The link-preview lines from `git show --stat 420dbdc`:

```
 web/index.html                          |  47 +++++++   (shared with session 02)
 web/package.json                        |   1 +
 web/public/og-image.png                 | Bin 0 -> 20115 bytes
 web/scripts/make-og-image.mjs           | 214 +++++++++++++++++++++++++++++
 web/tests/social-meta.test.ts           |  52 ++++++++
```

The committed `og-image.png` is 20115 bytes, the same size the script printed in the session.

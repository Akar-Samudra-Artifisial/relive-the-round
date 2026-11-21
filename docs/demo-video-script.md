# Demo video script (target ≤ 2:45, hard limit < 3:00)

Rules for the cut: public on YouTube; shows the live project running; **no copyrighted music** (silence,
own recording, or a royalty-free track with a license you can show); **no Riot or other third-party
logos/trademarks** on screen (no game client, no esports broadcast footage, no team logos). Do not
show pro player or team names, raw data, or the `data/` folder. Record at 1080p from
https://relive-the-round.vercel.app (production build, so there are no "(synthetic)" levels).

Narration: one voice, calm, short sentences. Total about 300 words.

| Time | Shot | On screen | Narration |
|---|---|---|---|
| 0:00-0:12 | Hook | Attract screen "Could you have clutched it?", then a fast cut to a 1v3 round in progress | "One player left. Three enemies. Twenty seconds. This really happened in a pro match. Now it's your turn." |
| 0:12-0:22 | Title | Project name "Relive the Round" + "Event Mini Game" + the live URL as text | "Relive the Round is a booth mini game built from real esports clutch data." |
| 0:22-0:35 | Pick a round | Playlist of 6 rounds (Kiln and Cistern), hover a blurb such as "1v3 · attack · spike down on A · pro …", press Enter | "Six real clutches, rebuilt on two original maps, Kiln and Cistern. Each one shows what the pro faced." |
| 0:35-1:10 | Play one round | Countdown hint (WASD / mouse / click / hold E), full round: enemies arrive on their recorded routes, react, a fight, a defuse or a win | "You take over the clutcher. The enemies follow the routes they really took, until they spot you. Then the bots hunt, retake, and go for the spike." |
| 1:10-1:20 | Score | Result screen: your stats vs "Pro #1", type 3 initials, leaderboard | "You get a score, the pro's result, and a spot on the booth leaderboard." |
| 1:20-1:42 | Two-panel replay | Replay: "you" left, pro right; press 2×, seek with arrows | "Then the key moment: your round and the pro's, side by side. Same start, different decisions." |
| 1:42-1:55 | Score card + QR | Download the PNG card; zoom on the QR | "Every attempt makes a score card with a QR code." |
| 1:55-2:10 | Challenge on a phone | Phone (no carrier/app logos visible) scans the QR, `/#c=…` opens the same round with the score to beat | "Scan it, and a friend gets the same round with your score to beat. That's how the queue at the booth grows." |
| 2:10-2:25 | Data pipeline | Simple slide or terminal: GRID feeds → clutch finder (10,776 clutches → 710 playable → 161 pro wins) → level JSON (schema v1) → original-map warp → game. Show `docs/spike-report.md` table or `uv run pytest` (43 passed); do not show raw data | "A Python pipeline finds clutch moments, keeps only tracks dense enough to replay, and exports versioned level files with no names in them." |
| 2:25-2:37 | JetBrains tooling | TODO(user): screen capture of the JetBrains IDE / Junie actually used, e.g. the task it did. Do not stage anything that did not happen | TODO(user): one sentence on how the JetBrains tool / Junie was used. |
| 2:37-2:45 | Closing | Text card: demo URL https://relive-the-round.vercel.app + repo URL TODO(user) + "MIT licensed" | "Relive the Round. Play it now. Link and source code below." |

## Recording checklist

- [ ] Use the production URL; the browser console shows no errors; the bookmarks bar and other tabs are hidden.
- [ ] A round that ends in a win or a clear loss within ~35 s (try several takes).
- [ ] The phone screen recording shows only the browser page.
- [ ] Audio: narration only, or royalty-free music with license noted in the YouTube description.
- [ ] Final length checked < 3:00 (target ≤ 2:45); upload as Public; paste the URL in `docs/devpost-submission.md`.

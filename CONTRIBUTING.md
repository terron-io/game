# Contributing to TERRON.io

Contributions are **welcome**. This repository is a snapshot of the production
source (published to satisfy AGPL-3.0 Section 13), which shapes the mechanics of
how a contribution lands — but not whether it is wanted:

- **Pull requests are read and considered.** TERRON.io is built by one person,
  so there is no SLA — reviews happen as capacity allows.
- **Accepted changes are not merged via the button.** Development happens in a
  private tree; an accepted PR is applied there and ships in a following public
  snapshot. Your PR is then closed with a reference, and you are credited in the
  snapshot commit message.
- **Issues are welcome too.** For game bugs the fastest route is the
  **[Telegram chat](https://t.me/terron_chat)** — it is read daily.
- By submitting a contribution you agree it is licensed under **AGPL-3.0**, the
  license of this project (inbound = outbound; you keep your copyright).

Good first contributions: bug fixes, performance work, translations. Large
features are worth discussing in the Telegram chat first — the game has a strict
"no new features without the owner's call" policy, and it would be a shame to
waste your work.

## If you want to fork

Forking TERRON.io is allowed; the license explicitly permits it. The AGPL-3.0
conditions, briefly:

1. **Your fork stays under AGPL-3.0.** You cannot close it or relicense it under
   softer terms — this is copyleft.
2. **Preserve the copyright notices:** © OpenFront LLC and contributors,
   © 2024 WarFront.io Team, © TERRON.io. Stripping attribution terminates your
   license automatically (Section 8), and any further use becomes infringement.
3. **Running it online obliges you to offer the source to your players**
   (Section 13). The requirement is not "publish on GitHub" specifically — it is
   to give access to the people who play it.
4. **Mark your changes:** modified files must carry a notice stating that you
   changed them, and the date (Section 5a).
5. **Do not misrepresent your fork as the original** (Section 7c) — use your own
   name and branding.

See [NOTICE.md](NOTICE.md) for the Section 7 additional terms covering
TERRON.io's own contributions.

> ⚠️ **On trademarks.** Neither AGPL nor MIT grants rights to a **name or logo**.
> A license covers code; branding sits outside it — a fork needs its own name
> and look.

## An easier path

If your goal is to build **your own** game rather than a derivative of this one,
the MIT-licensed ancestry is a far simpler starting point:

- upstream OpenFront.io was under **MIT until 2025-09-05**, and that version asks
  almost nothing of you (keep the license text and the copyright notice);
- **[WarFront.io](https://github.com/WarFrontIO)** — the shared ancestor of the
  genre — is MIT in full.

Links to the specific MIT-era commits are shown in-game on the
[Credits & Licenses](https://terron.io/copyrights) page.

## Snapshot cadence

Snapshots are published from production roughly every one to two weeks, once new
work has proven stable. If the deployed version is ahead of the latest snapshot,
its Corresponding Source is still yours under AGPL-3.0 Section 13 — ask in the
Telegram chat and it will be provided at no charge. Note that production doubles
as the final trial for features under evaluation: a newer version may carry
experimental mechanics or changes reverted days later. To build on the code, the
published snapshot is the safer starting point.

## Licenses

- Code — [AGPL-3.0](LICENSE)
- Assets in `resources/` — [CC BY-SA 4.0](LICENSE-ASSETS)
- TERRON.io's additional Section 7 terms — [NOTICE.md](NOTICE.md)
- Attribution and lineage — [CREDITS.md](CREDITS.md), [LICENSING.md](LICENSING.md)

# TERRON.io

**TERRON.io** is a browser-based multiplayer territorial strategy game. Expand your
nation, forge and break alliances, deploy ultimates, and dominate the world map.
Play at **[TERRON.io](https://terron.io)**.

---

## What this repository is

This is the **source code of the TERRON.io client and game server** — the complete
Corresponding Source for the version running at terron.io, as required by
**AGPL-3.0 Section 13**.

### Lineage

```
Territorial.io  →  WarFront.io (MIT)  →  OpenFront.io (© OpenFront LLC, AGPLv3)  →  TERRON
   the genre        early open clone           upstream of this fork              this fork
```

TERRON.io is a substantially reworked fork of
[OpenFront.io](https://github.com/openfrontio/OpenFrontIO). The following
subsystems were written from scratch and are not part of upstream:

- **Ultimates** — the pick system, headquarters buildings, dozens of ultimates
  with their own mechanics, and the unlock tree
- **Aviation** — airports, airborne assault, drones
- **Design and interface** — visual identity, site pages, in-game HUD, mobile
  controls
- **Skins** — editor, registry and rendering, including nuclear fallout skins
- **Tutorial** — a guided sandbox and our own map generator
- **Progression and social** — ratings, achievements, titles, clans, friends,
  event matches, speedrun
- **Game modes** — fog of war, capitals
- **Russian localization** — interface, nation names, country names

## Licenses and attribution

| What | License |
|---|---|
| Game code | **GNU AGPL-3.0** ([LICENSE](LICENSE)) |
| Assets in `resources/` | **CC BY-SA 4.0** ([LICENSE-ASSETS](LICENSE-ASSETS)) |
| TERRON.io's changes and original assets | © TERRON.io ([NOTICE.md](NOTICE.md)) |

**Copyright notices that any fork must preserve:**

- © OpenFront LLC and contributors
- © 2024 WarFront.io Team
- © TERRON.io — see [NOTICE.md](NOTICE.md) for the Section 7 terms covering
  TERRON.io's own contributions

They are shown in-game on the **Credits & Licenses** page (`/copyrights`) and in
[CREDITS.md](CREDITS.md). License history: [LICENSING.md](LICENSING.md).

> ⚠️ **Planning to fork?** AGPL allows it, but it has conditions: your fork stays
> under AGPL, copyright notices must not be stripped (removing them terminates
> your license automatically, §8), running it online obliges you to offer the
> source to your players (§13), and changes must be marked (§5a). Separately:
> **no license grants rights to a name or logo** — trademarks sit outside
> copyright, so give your fork its own name and branding.
>
> Building your own game from scratch? The **MIT**-licensed ancestor is an easier
> starting point: upstream was under MIT until 2025-09-05, and
> [WarFront.io](https://github.com/WarFrontIO) is MIT in full.

## How this repository is maintained

TERRON.io is built by **one person**, without a team. That shapes what this
repository is and how it behaves:

- **Snapshots, not a live mirror.** Updates land here roughly **every one to two
  weeks**, as capacity allows.
- **Published from production, not from development.** New work is first exercised
  on a staging environment and only reaches production once it proves stable. What
  you see here is the code that actually runs at terron.io — not half-finished work
  in progress. Publishing raw development code would misrepresent what the service
  actually is.
- **No support commitments.** No SLA, no guaranteed response, no roadmap promises.

> **If the running version is ahead of the latest snapshot here**, you are still
> entitled to its Corresponding Source under AGPL-3.0 Section 13. Ask in the
> [Telegram chat](https://t.me/terron_chat) and it will be provided at no charge.
> The interval above is a publishing cadence, not a limit on that right.
>
> Be aware of what you would be asking for, though: production also serves as the
> final trial for features that are still being evaluated. A version newer than
> the latest snapshot may contain experimental mechanics, balance still being
> tuned, or changes that get reverted within days — it can simply be broken. The
> snapshot published here is the state that survived that trial. **If you intend
> to build on this code rather than audit it, waiting for the next snapshot will
> save you the trouble.**

## No warranty

This program is distributed **WITHOUT ANY WARRANTY** — without even the implied
warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See sections 15
and 16 of the [LICENSE](LICENSE) for the full disclaimer of warranty and
limitation of liability.

It is a game, maintained by one person in their own time. Use it, fork it, run it
— but do so at your own risk.

## What is not included

As with upstream, the platform backend is not part of this repository — it is a
**separate program** communicating with the game over HTTP only:

- accounts and authentication, economy, progression, ratings, moderation,
  analytics;
- native mobile wrappers;
- proprietary maps and content-authoring tooling.

The game builds and runs without them: singleplayer and the local server work,
while online features (login, shop, stats) degrade to anonymous mode.

## Build and run

```bash
npm run inst     # install dependencies (inst, not install)
npm run dev      # client + server with hot reload → localhost:9000
```

Other commands:

```bash
npm run build-prod   # production build (tsc + vite)
npm test             # tests (Vitest)
npm run lint         # ESLint
npm run format       # Prettier
```

Requires **npm 10.9.2+** and a modern browser.

## Structure

| Directory | Contents |
|---|---|
| `src/core` | deterministic simulation (runs in a Web Worker) |
| `src/client` | rendering (WebGL2), UI (Lit + Tailwind), networking |
| `src/server` | game server: lobbies, intent relay, match archiving |
| `resources` | maps, flags, sounds, atlases, languages |
| `tests` | core, server and client tests |

The simulation runs **on every client**; the server only relays intents: a player
action becomes an intent, the server bundles intents into a turn, and every client
applies it deterministically.

## Contributing

Pull requests and issues are **welcome** — they are read and considered. One
practical caveat: this repository is a snapshot of production, so an accepted
change is applied to the internal tree and ships in a following snapshot (with
credit) rather than being merged directly. Details and the fork rules:
[CONTRIBUTING.md](CONTRIBUTING.md).

Found a bug in the game? The fastest route is the
[Telegram chat](https://t.me/terron_chat).

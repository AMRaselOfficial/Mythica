# MYTHICA — Build Contract (v1)

Single source of truth for the four build teams. The user (Rasel) approved this
architecture; it overrides the PRD's Firebase-only rule. A Node game server on
Render provides authoritative logic; the web app is a static Next.js export on
GitHub Pages; Firebase provides Auth + Firestore.

Repo root: `~/workspace/mythica/`

```
mythica/
  API_CONTRACT.md            # this file
  content/
    STUB-content.json        # minimal schema example for dev (server/web build against this)
    mythica-content.json     # FULL content (content designer writes this; replaces stub at integration)
  web/                       # Next.js 14 app (webapp builder)
  server/                    # Express server (server builder)
  seed/                      # seed.json + seed.js (coordinator writes)
  firestore.rules            # coordinator writes
  render.yaml                # coordinator writes
  .gitignore                 # coordinator writes
  README.md                  # coordinator writes
```

---

## 1. Content schema (`content/mythica-content.json`)

Top-level keys: `version`, `rarities`, `items`, `hunt`, `xpCurve`,
`achievements`, `events`, `settings`.

```json
{
  "version": 1,
  "rarities": [
    {"id":"common","name":"Common","color":"#9aa3b2"},
    {"id":"uncommon","name":"Uncommon","color":"#4ade80"},
    {"id":"rare","name":"Rare","color":"#38bdf8"},
    {"id":"epic","name":"Epic","color":"#c084fc"},
    {"id":"legendary","name":"Legendary","color":"#fbbf24"},
    {"id":"mythic","name":"Mythic","color":"#fb7185"}
  ],
  "items": [
    {
      "id": "ember-fox",
      "name": "Ember Fox",
      "type": "sprite",
      "rarity": "uncommon",
      "description": "2-3 sentences of ORIGINAL lore. Never copy existing games.",
      "image": "assets/sprites/ember-fox.webp",
      "sellable": true,
      "tradable": true,
      "upgradeable": false,
      "maxLevel": 1,
      "upgradeCosts": [],
      "baseValue": 120,
      "tags": ["forest","fire"],
      "active": true,
      "dropWeight": 28,
      "stats": {"power": 14, "spirit": 22}
    }
  ],
  "hunt": {
    "cooldownSec": 60,
    "theaterSecMin": 10,
    "theaterSecMax": 30,
    "xpMin": 8,
    "xpMax": 16,
    "petalFindChance": 0.25,
    "petalFindMin": 3,
    "petalFindMax": 12,
    "dropChance": 0.65
  },
  "xpCurve": {"base": 100, "growth": 1.45, "maxLevel": 50},
  "achievements": [
    {
      "id": "first-hunt",
      "name": "First Tracks",
      "description": "Complete your first hunt.",
      "icon": "assets/icons/ach-first-hunt.webp",
      "criteria": {"type": "hunts", "target": 1},
      "reward": {"xp": 25, "petals": 10}
    }
  ],
  "events": [
    {
      "id": "lumen-tide-2026",
      "title": "The Lumen Tide",
      "description": "...",
      "banner": "assets/events/lumen-tide.webp",
      "startAt": "2026-10-15T00:00:00Z",
      "endAt": "2026-10-31T23:59:59Z",
      "active": true,
      "featured": true,
      "rewards": [{"itemId": "tide-drake", "quantity": 1}]
    }
  ],
  "settings": {"startingPetals": 20, "huntCooldownSec": 60, "contentVersion": 1}
}
```

Rules for the schema:
- `xpCurve`: XP to advance from level n to n+1 = `floor(base * n^growth)`.
- `image` / `icon` / `banner` paths are relative, NO leading slash
  (`assets/...`). The web app prefixes the Pages basePath at render time.
- Weapon `upgradeCosts[i]` = petals to go from level i to i+1
  (length must equal maxLevel-1 for upgradeable weapons).
- `dropWeight` is relative within the whole item list; server rolls only
  `active` items.

### 1a. FIXED item roster (IDs, types, rarities are LOCKED)

The content designer MUST use exactly these 13 items (may not rename IDs).
The art team MUST generate art for exactly these filenames.

Sprites (`assets/sprites/<id>.webp`):
| id | rarity |
|---|---|
| moss-wisp | common |
| gloom-moth | common |
| ember-fox | uncommon |
| tide-drake | rare |
| quartz-stag | epic |
| umbral-serpent | legendary |
| void-phoenix | mythic |

Weapons (`assets/weapons/<id>.webp`):
| id | rarity | upgradeable | maxLevel |
|---|---|---|---|
| whisper-dagger | common | yes | 3 |
| thornblade | common | yes | 3 |
| moonpetal-bow | uncommon | yes | 4 |
| emberbrand | rare | yes | 4 |
| tidecaller-trident | epic | yes | 5 |
| starfall-hammer | legendary | no | 1 |

### 1b. Asset manifest (art team generates ALL of these)

Base dir: `web/public/assets/`. All lowercase. WebP preferred, PNG acceptable
ONLY if WebP conversion is unavailable (report any deviation).

- `logo/mythica-logo.webp` — game emblem/logo, transparent-ish dark bg
- `backgrounds/night-wilds.webp` — 16:9 dark fantasy forest night (landing + hunt)
- `backgrounds/dashboard-bg.webp` — 16:9 subtle dark magical backdrop
- `events/lumen-tide.webp` — 16:9 event banner, glowing tide theme
- `sprites/<7 ids>.webp` — square creature portraits (see roster)
- `weapons/<6 ids>.webp` — square weapon icons on dark background (see roster)
- `icons/icon-petal.webp` — petal currency glyph
- `icons/icon-xp.webp` — xp star glyph
- `icons/ach-first-hunt.webp`, `icons/ach-collector-10.webp`,
  `icons/ach-rare-hunter.webp`, `icons/ach-trader.webp`, `icons/ach-rich-500.webp`,
  `icons/ach-weapon-master.webp` — 6 achievement medals
  (content designer must use exactly these achievement IDs)

Style: original dark-fantasy painterly, cohesive palette
(deep indigo/teal night + ember-gold accents). No text in images (except the
logo wordmark), no watermarks, nothing copied from existing games.

---

## 2. Server API (Express, `server/`)

Base URL from web env `NEXT_PUBLIC_API_URL` (e.g. `https://mythica-server.onrender.com`).

Auth: every `/api/*` call sends `Authorization: Bearer <Firebase ID token>`.
Server verifies with Admin SDK; uid = token.uid.
Dev/test bypass: if env `FAKE_AUTH=1`, accept `Bearer test-<uid>` as uid `<uid>`.

- `GET /health` → `200 {"ok":true,"service":"mythica-server","time":<ms>}`
- `POST /api/hunt` body `{}` →
  - Server logic (transactional, server time):
    1. Load player. If `now - lastHuntAt < cooldownSec*1000` →
       `429 {"ok":false,"error":"cooldown","retryAfterMs":<ms>}`.
    2. Set `lastHuntAt` = server timestamp AT HUNT START.
    3. Roll: XP in [xpMin,xpMax]; petals find per petalFindChance;
       item drop per dropChance using dropWeight among active items.
    4. Apply XP → handle level-ups via xpCurve; grant item to
       `inventories/{uid}/items/{itemId}` (create or quantity+1);
       add petals; update `updatedAt`.
    5. COMMIT the transaction immediately.
    6. THEN sleep random theaterSecMin–theaterSecMax (env-overridable
       `THEATER_MIN_MS`/`THEATER_MAX_MS`, default 10000/30000).
    7. Respond `200 {"ok":true,"xpGained","petalsFound","drop":null|{"itemId","name","rarity","quantity","image"},"leveledUp","level","xp","petals","nextHuntAt"}`.
  - `401 {"ok":false,"error":"unauthorized"}` when token invalid.
- `POST /api/market/list` body `{"itemId","quantity","price"}` →
  validate: item exists, sellable, qty>=1 integer, price>=1 integer,
  player owns >= quantity. Transaction: decrement inventory, create
  `marketplace/{listingId}` `{sellerUid,itemId,quantity,price,status:"active",createdAt}`.
  → `200 {"ok":true,"listingId"}`. Errors: `not_sellable`, `insufficient_quantity`, `bad_price`.
- `POST /api/market/purchase` body `{"listingId","idempotencyKey"}` →
  transaction: listing status active; buyer != seller; buyer petals >= price.
  Transfer: inventory to buyer, petals buyer→seller, listing status sold,
  buyerUid/soldAt set. Idempotent: same key returns original result.
  → `200 {"ok":true,"itemId","quantity","price"}`.
  Errors: `listing_unavailable`, `insufficient_petals`, `own_listing`.
- `POST /api/trades/complete` body `{"tradeId","idempotencyKey"}` →
  trade doc must have `status:"accepted"`; caller must be offeredBy or
  offeredTo. Transaction: verify offeredBy still owns offerQty of offerItemId
  and offeredTo still owns wantQty of wantItemId; swap quantities;
  set status completed + completedAt. Idempotent.
  → `200 {"ok":true}`. Errors: `not_participant`, `bad_state`, `insufficient_items`.
  (Trade lifecycle: offeredBy creates doc via client → status `offered`;
  offeredTo accepts via client → status `accepted`; then this endpoint.)
- `POST /api/upgrade` body `{"itemId","idempotencyKey"}` →
  validate: item upgradeable, owned, upgradeLevel < maxLevel,
  petals >= upgradeCosts[upgradeLevel]. Transaction: deduct petals,
  upgradeLevel+1. Idempotent.
  → `200 {"ok":true,"itemId","newLevel"}`.
  Errors: `not_upgradeable`, `max_level`, `insufficient_petals`, `not_owned`.

General: JSON bodies, CORS enabled (env `CLIENT_URL`, default `*` in dev),
simple in-memory per-uid rate limit (60 req/min), `PORT` env.
Firestore access via Admin SDK; service account from
`FIREBASE_SERVICE_ACCOUNT` env (JSON string) or
`GOOGLE_APPLICATION_CREDENTIALS` file.
Dev/test: `USE_FAKE_DB=1` uses an in-memory Firestore stand-in
(implement `collection/doc/get/set/update/runTransaction`) so tests and the
coordinator's smoke test run with no credentials.
Content: `CONTENT_PATH` env, default `<server.js dir>/../content/STUB-content.json`
(full content replaces the stub at integration; code must be data-driven).

---

## 3. Firestore document shapes

- `players/{uid}`: `{displayName,email,petals,level,xp,createdAt,updatedAt,lastHuntAt,musicEnabled,sfxEnabled,accountStatus,favoriteItemId?}`
  New player defaults: petals 20, level 1, xp 0, musicEnabled true,
  sfxEnabled true, accountStatus "active".
- `items/{itemId}`: content item object (seeded from content JSON).
- `inventories/{uid}/items/{itemId}`: `{quantity,upgradeLevel,obtainedAt,favorite}`
- `marketplace/{listingId}`: `{sellerUid,itemId,quantity,price,status,createdAt,buyerUid?,soldAt?}`
  status ∈ `active|sold|canceled`.
- `trades/{tradeId}`: `{offeredBy,offeredTo,offerItemId,offerQty,wantItemId,wantQty,status,createdAt,acceptedAt?,completedAt?}`
  status ∈ `offered|accepted|completed|canceled`.
- `events/{eventId}`, `quests/{questId}`, `achievements/{achievementId}`: defs.
- `players/{uid}/achievements/{aid}`: `{progress,completed,completedAt,claimedAt?}`
- `gameSettings/live`: `{contentVersion,huntCooldownSec,maintenance}`

Client-write policy (rules enforce; server uses Admin SDK and bypasses rules):
- `players/{uid}`: owner read; owner may write ONLY
  `displayName, musicEnabled, sfxEnabled, favoriteItemId`.
  `petals,xp,level,lastHuntAt,accountStatus,createdAt,email` are NEVER
  client-writable.
- `inventories/...`: owner read; owner may write ONLY `favorite`.
- `marketplace`: authenticated read; create allowed when `sellerUid==uid`
  and shape valid; seller may set `status:"canceled"` only.
- `trades`: participants read; `offeredBy==uid` may create (`offered`);
  `offeredTo==uid` may move `offered→accepted` or either may cancel.
- Catalog (`items,events,quests,achievements,gameSettings`):
  authenticated read; no client writes.

---

## 4. Web app (`web/` — Next.js 14, App Router)

- `output: 'export'` in `next.config.js`; `images.unoptimized: true`;
  `basePath: process.env.NEXT_PUBLIC_BASE_PATH || ''` (same for assetPrefix).
  All internal links and asset URLs go through `lib/paths.js`
  (`asset('assets/sprites/ember-fox.webp')`, `link('/hunt')`).
- Env (`.env.local.example` documents all):
  `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`,
  `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`,
  `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BASE_PATH`.
- `lib/firebase.js`: client init from env (guard: show friendly
  "not configured" state if missing).
- `contexts/AuthContext.js`: signup/login/logout/reset, session restore,
  player-doc create-on-first-login (petals 20 etc.), expose `{user, player, idToken, ...}`.
- Pages: `/` landing, `/login`, `/signup`, `/reset`, `/dashboard`,
  `/hunt`, `/inventory`, `/marketplace`, `/trades`, `/events`,
  `/profile`, `/settings`. Protected pages redirect to `/login` when signed out.
- Content: `import content from '../../content/STUB-content.json'`
  (data-driven; no hardcoded item IDs except in tests).
- **Hunt page UX (implement EXACTLY):**
  1. On "Begin Hunt": poll `GET {API_URL}/health` every 4s, up to 3 minutes,
     while playing a phased "waking the wilds" animation
     (phases: fireflies → mist → distant roar, CSS/canvas, cool dark-fantasy).
     If the server never wakes: friendly retry state
     ("The wilds are still sleeping — Try again").
  2. When healthy: `POST {API_URL}/api/hunt` with ID token.
     If `429`: show cooldown countdown from `retryAfterMs`.
  3. During the wait: hunting animation phases
     (tracking → rustling → reveal).
  4. On result: show XP/petals/drop; Rare+ gets a fanfare
     (full-screen shimmer + `raredrop` SFX).
  5. Hunt button shows live cooldown countdown; disabled while a hunt is
     in flight or on cooldown. Cooldown source of truth: server `nextHuntAt`.
- Marketplace: browse active listings (paginated), buy (idempotency key
  = crypto.randomUUID per click, button disabled while pending), my listings
  with cancel, create listing form.
- Trades: create offer, incoming/outgoing lists, accept/decline,
  complete via `/api/trades/complete` after both confirmed.
- Inventory: grid, filters (All/Sprites/Weapons), rarity filter, search,
  detail modal with sell/list/upgrade actions.
- Events: list from Firestore, banner, active/ended states.
- Profile: display name, level, XP bar, petals, collection counts,
  achievements, join date, favorite item.
- Settings: display name, music mute, SFX mute — INDEPENDENT toggles,
  persisted to player doc + localStorage.
- `lib/audio.js`: WebAudio-synthesized background music loop
  (dark-fantasy pad/arpeggio, generated in code) + SFX:
  `click, levelup, raredrop, purchase, upgrade, error, reveal`.
  No audio files. Respect autoplay policies (start on first user gesture).
- Styling: plain CSS (no Tailwind), mobile-first responsive dark fantasy,
  rarity colors from content, visible focus states, reduced-motion respect.
- Verify with `npm install && npm run build` (static export must succeed).

---

## 5. Non-goals for this build

No deployment (coordinator does not deploy; Rasel does).
No credentials handling. No Cloud Functions. No paid services.

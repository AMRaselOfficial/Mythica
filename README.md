# MYTHICA

An online fantasy collection-and-adventure game. Players create an account,
receive 20 Petals, hunt for collectible Sprites and Weapons across 6 rarity
tiers, upgrade weapons, trade and sell on the marketplace, join monthly events,
and earn achievements.

## Architecture

| Piece | Where | What |
|---|---|---|
| `web/` | GitHub Pages (static) | Next.js 14 static export — the game frontend |
| `server/` | Render free web service | Node/Express — authoritative game logic (hunts, market, trades, upgrades) |
| Firebase | Google Cloud | Auth (email/password) + Firestore (data) |

The browser is untrusted: hunt rolls, cooldowns, purchases, trades, and
upgrades are settled by the Render server with the Firebase Admin SDK.
Firestore Security Rules (`firestore.rules`) additionally lock down what
clients may write directly (cosmetic/settings fields only — never Petals,
XP, levels, or inventory quantities).

## Repo layout

```
web/                 Next.js app (static export -> GitHub Pages)
server/              Express game server (-> Render)
content/             mythica-content.json — all game data (items, drop tables, XP curve, achievements, event)
seed/                seed.js — loads the catalog into Firestore (run once per content update)
firestore.rules      Restrictive security rules
render.yaml          Render blueprint for the game server
API_CONTRACT.md      Build contract both teams coded against
```

## Rasel's setup (deployment)

### 1. GitHub — frontend hosting
1. Create a repo named `mythica` and push this folder.
2. Settings -> Pages -> Deploy from branch -> `main`, folder `/` — then
   configure Pages to serve `web/out` (see "Frontend build" below), or use
   the included GitHub Action (`.github/workflows/pages.yml`) which builds
   `web/` and deploys `web/out` automatically.
3. Note your Pages URL: `https://<username>.github.io/mythica`.

### 2. Firebase — accounts + database
1. console.firebase.google.com -> create project **Mythica**.
2. Add a Web app (`</>`), copy the config values.
3. In `web/`, copy `.env.local.example` to `.env.local`, paste values, and set
   `NEXT_PUBLIC_API_URL` to your Render URL (step 3) and
   `NEXT_PUBLIC_BASE_PATH=/mythica` (project-site subpath).
4. Build -> Authentication -> Sign-in method -> enable **Email/Password**.
5. Build -> Firestore Database -> Create database -> **Production mode**.
6. Rules tab -> paste `firestore.rules` -> Publish.
7. Project settings -> Service accounts -> Generate new private key
   (keep this file private — it is only for the seed step and the server).
8. Seed the catalog: `cd seed && npm install`, then
   `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node seed.js`.

### 3. Render — game server
1. Sign up at render.com (GitHub login is easiest).
2. New -> Blueprint -> connect the `mythica` repo (uses `render.yaml`).
3. In the service's Environment tab add secret `FIREBASE_SERVICE_ACCOUNT`
   (paste the whole service-account JSON), and set `CLIENT_URL` to your
   GitHub Pages URL.
4. Deploy. Note the URL: `https://mythica-server.onrender.com`
   (free plan: sleeps after 15 min idle, ~30–60s first-request wake-up —
   the game shows a "waking the wilds" animation for this).

### 4. Frontend build
```
cd web && npm install && npm run build   # static export -> web/out
```
Deploy `web/out` to GitHub Pages (Pages settings or the Action).

### 5. Smoke test
Register two accounts, hunt on both (second hunt within 60s must show the
cooldown), list an item, buy it from the other account, run a trade,
upgrade a weapon, toggle music/SFX independently.

## Admin panel (separate, private)

Staff tooling lives in a SECOND repo: `~/workspace/mythica-admin/`
(keep it in a **private** GitHub repo — never link it publicly).

- Deploy it as its own Render free web service (its `render.yaml` is included).
- It talks only to the game server's `/api/admin/*` endpoints.
- Granting admin: run once from the game server repo —
  `node scripts/make-admin.js <uid-or-email>` — with your Google credentials
  (`GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`). This sets the
  Firebase custom claim `admin: true` on that user.
- Admin login: email/password, then the console verifies the admin claim;
  non-admins see "Not authorized" and nothing else.
- Banning a user sets `players/{uid}.accountStatus` to `"banned"`; the game
  server rejects their API calls with 403 `account_banned`, and the web app
  shows a suspension screen and signs them out.
- All admin actions (ban/unban) and every authoritative game action
  (hunts, listings, purchases, trades, upgrades) are silently logged to the
  `activityLogs` collection — readable only via the Admin SDK, never by clients.

## Local development

- Web: `cd web && npm install && npm run dev` (needs `.env.local`).
- Server: `cd server && npm install && FAKE_AUTH=1 USE_FAKE_DB=1 THEATER_MIN_MS=1500 THEATER_MAX_MS=2000 npm start`
- Server tests: `cd server && npm test`

## Originality

All names, lore, art, and mechanics are original creations for Mythica.
Nothing is copied from existing games or franchises.

'use client';
import { useMemo, useState } from 'react';
import Protected from '../components/Protected.js';
import { Icon } from '../components/icons.js';
import { link } from '../../lib/paths.js';
import { sfx } from '../../lib/audio.js';

// ---------------------------------------------------------------------------
// The Mythica Player's Guide — a book-style, searchable guide to the game.
// Chapters are the "book"; the index links to each chapter; the search box
// filters chapters and the FAQ in real time as you type.
// ---------------------------------------------------------------------------

const CHAPTERS = [
  {
    id: 'what-is-mythica',
    title: 'What is Mythica?',
    icon: 'moon',
    go: '/dashboard',
    goLabel: 'Dashboard',
    body: [
      'Mythica is a dark-fantasy collection and adventure game you play in your browser. You are a traveler in the night wilds. You hunt for sprites and weapons, grow your collection, upgrade your gear, trade with other travelers, and climb the leaderboard.',
      'The core loop is simple: Hunt, then Collect, then Upgrade, then Trade, then Rise. Everything else in the game feeds back into that loop.',
      'Your two currencies of progress are Petals and Experience (XP). Petals buy and sell things. XP raises your traveler level, which unlocks rarer finds.',
    ],
  },
  {
    id: 'getting-started',
    title: 'Getting started: your first day',
    icon: 'gamepad',
    go: '/hunt',
    goLabel: 'Start hunting',
    body: [
      'Every new traveler starts with 20 Petals and a Worn Blade already equipped. The Worn Blade cannot be sold or traded, but it can be upgraded and merged like any weapon.',
      'Step 1: Go to Hunt and tap Begin Hunt. Your first hunt can drop an item, grant XP, and sometimes find Petals.',
      'Step 2: Open Inventory to see what you found. Sprites go into your collection; weapons can be equipped; materials are used for upgrades.',
      'Step 3: Check your Dashboard. It shows your Petals, level, XP progress, collection size, recent discoveries, and any featured event.',
      'Step 4: When you have a stronger weapon, equip it before your next hunt — only the equipped weapon decides what rarity you can find.',
      'Tip: your display name cannot be changed in Settings, so pick a name you like at signup. Your Profile shows your traveler code (your Trade ID) — share that code, never your long account ID.',
    ],
  },
  {
    id: 'hunt',
    title: 'Hunting',
    icon: 'moon',
    go: '/hunt',
    goLabel: 'Hunt',
    body: [
      'Hunting is how you find almost everything. Each hunt takes a moment, then reveals its result immediately.',
      'Cooldown: there are 10 seconds between hunts, enforced by the server. The Hunt button shows a countdown and unlocks automatically when the cooldown ends.',
      'Each hunt grants 8–16 XP. About 2 in 3 hunts drop an item, and sometimes a hunt also finds 3–12 Petals.',
      'If the game server is waking up, you will see a hunting animation while it wakes. That is normal — your hunt starts once it is awake.',
      'A drop must pass two gates: your traveler level and your equipped weapon’s power. See the Weapons and Rarity chapters for the exact numbers.',
    ],
  },
  {
    id: 'petals-xp-levels',
    title: 'Petals, XP and levels',
    icon: 'petals',
    go: '/dashboard',
    goLabel: 'Dashboard',
    body: [
      'Petals are the coin of the realm. You earn them from hunts, marketplace sales, events, referral bonuses and redeem codes, and you spend them in the Marketplace. Petals also have real-world value when you withdraw — see the Withdrawals chapter.',
      'XP raises your traveler level. The XP needed for the next level grows as you level up (level n to n+1 costs floor(100 × n^1.45) XP), up to level 50.',
      'Your level gates what can drop: Common items from level 1, Uncommon from level 3, Rare from level 8, Epic from level 15, Legendary from level 25, and Mythic from level 40. Level alone is not enough — your equipped weapon’s power must also unlock that rarity.',
      'The Dashboard shows your Petals, level and XP bar at a glance.',
    ],
  },
  {
    id: 'collection-inventory',
    title: 'Your collection and Inventory',
    icon: 'inventory',
    go: '/inventory',
    goLabel: 'Inventory',
    body: [
      'There are 170+ items to collect: sprites (creatures), weapons (your hunting gear) and upgrade materials.',
      'Inventory has filter tabs, including a Materials tab, so you can check what you own and what an upgrade still needs.',
      'Each item card shows its rarity, and for weapons its power, level and stars. Tap an item to see its details and what you can do with it: equip it, upgrade it, merge duplicates, list it for sale, or offer it in a trade.',
      'Not everything can be sold or traded. Your starter Worn Blade cannot be sold or traded, and a few special items are marked unsellable. If an item has no sell or trade option, that is by design.',
    ],
  },
  {
    id: 'weapons-rarity-power',
    title: 'Weapons, rarity and power',
    icon: 'trophy',
    go: '/inventory',
    goLabel: 'Inventory',
    body: [
      'Every weapon has a power value. Power decides the rarest item your hunts can find — but only the weapon you have equipped counts. One weapon is equipped at a time.',
      'Power formula: power = base × (1 + 0.5 × upgrade level) × 1.5^stars. Upgrading raises the level part; merging duplicates raises the stars part.',
      'Base power by rarity: Common 200, Uncommon 1,500, Rare 12,000, Epic 100,000, Legendary 800,000, Mythic 5,000,000.',
      'Equipped power unlocks rarities on hunts: Uncommon at 2,000+, Rare at 20,000+, Epic at 200,000+, Legendary at 1,500,000+, Mythic at 5,000,000+.',
      'The scale is designed so a fully maxed 6-star weapon of one tier unlocks the next tier — there are no dead ends, but reaching Mythic power takes months of play, not days.',
      'The Hunt page shows your equipped weapon’s power and the highest rarity you can currently find.',
    ],
  },
  {
    id: 'upgrading',
    title: 'Upgrading weapons',
    icon: 'settings',
    go: '/inventory',
    goLabel: 'Inventory',
    body: [
      'Open Inventory, pick a weapon, and open its upgrade view. It shows the exact materials and Petals each upgrade needs, how many of each material you own, and how many you still need.',
      'Each weapon has its own upgrade recipe and its own maximum level, shown in Inventory. The Upgrade button stays disabled until you own everything the upgrade requires.',
      'Your traveler level also gates upgrade materials, so some upgrades only open up as you level. If an upgrade looks locked, hunt more and level up first.',
      'Upgrading is permanent progress on that weapon — it raises the weapon’s power for every future hunt while it is equipped, and it counts toward achievements and the leaderboard.',
    ],
  },
  {
    id: 'stars-merging',
    title: 'Stars and merging duplicates',
    icon: 'gift',
    go: '/inventory',
    goLabel: 'Inventory',
    body: [
      'When you own duplicate copies of the same weapon, you can merge them to raise its star tier, up to 6 stars (☆☆☆☆☆☆).',
      'Each star multiplies power by 1.5, so stars matter as much as upgrades: a high-star weapon of a lower rarity can out-power a low-star weapon of a higher rarity.',
      'Do not sell or trade away duplicates of a weapon you plan to keep until you have checked whether merging them would push it over the next rarity unlock threshold.',
    ],
  },
  {
    id: 'marketplace',
    title: 'Marketplace: buying and selling',
    icon: 'shop',
    go: '/marketplace',
    goLabel: 'Marketplace',
    body: [
      'The Marketplace is where travelers buy and sell items for Petals. Use the search box under Browse Listings to search by item name; clearing the search returns you to browsing.',
      'To buy: find a listing, check its price in Petals, and tap Buy. If you cannot afford it, the Buy button tells you so. Buying updates your Petal balance and adds the item to your Inventory.',
      'To sell: open Create Listing, pick an item you own that is sellable, choose how many to list and set your price in Petals. You can cancel your own listings.',
      'If the Create Listing form says you own nothing sellable, you either own no sellable items right now or your sellable items are already listed. Your starter Worn Blade will never appear there — it cannot be sold.',
      'Marketplace prices are set by other players, so the same item can cost very different amounts on different days. Search before you buy.',
    ],
  },
  {
    id: 'trades',
    title: 'Trades: swapping with other travelers',
    icon: 'trades',
    go: '/trades',
    goLabel: 'Trades',
    body: [
      'Trades are direct item-for-item swaps with another traveler. No Petals change hands in a trade — it is items for items.',
      'To trade with someone, you need their traveler code. That code is the same code shown on their Profile and used for referrals — players call it the Trade ID.',
      'In Trades, enter the recipient’s traveler code and tap Find. If the code is wrong or the traveler cannot be found, you will see “No traveler found”. Then pick the items you offer, send the trade, and wait for the other traveler to accept or reject it.',
      'Both sides confirm before a trade is sealed, so check what you are giving and what you are getting before you accept. Trades do not earn referral bonuses for anyone — only hunts and marketplace earnings count toward referral payouts.',
    ],
  },
  {
    id: 'events-medals',
    title: 'Events and medals',
    icon: 'events',
    go: '/events',
    goLabel: 'Events',
    body: [
      'Events are limited-time challenges with rewards. Open Events to see what is live, join an event, and track your progress toward its objective.',
      'Event objectives are things like completing a set number of hunts or inviting a set number of friends. Finish the objective and claim your reward before the event ends.',
      'Some events carry medals in Gold, Silver and Bronze tiers. Event winners receive a medal card on their Profile, showing the medal name, the event, and the date it was won — and medals also appear on the event itself.',
      'Check the Dashboard’s Featured Event section so you never miss a live event.',
    ],
  },
  {
    id: 'leaderboard',
    title: 'Leaderboard',
    icon: 'trophy',
    go: '/leaderboard',
    goLabel: 'Leaderboard',
    body: [
      'The Leaderboard ranks travelers by their strongest weapon’s power — not by level, Petals or collection size.',
      'It shows a Global Top 20 plus “Your League”: you, centered with the 5 travelers above you and the 5 below you, so you can always see who you are chasing and who is chasing you.',
      'Your best weapon power refreshes after hunts, upgrades, merges, trades, marketplace purchases and admin grants. If you just upgraded, give the page a moment and check again.',
      'The fastest way to climb is not to hoard Petals — it is to equip, upgrade and merge your strongest weapon.',
    ],
  },
  {
    id: 'friends-chat',
    title: 'Friends, Agora and Veyra',
    icon: 'agora',
    go: '/agora',
    goLabel: 'Agora',
    body: [
      'Friends: tap any traveler’s name in Agora to open their traveler profile, then Add Friend. Incoming requests live in the Friends section of your Profile, where you accept or reject them.',
      'Agora is the public group chat. Anyone signed in can read it, but you need level 10 to send messages there. Below level 10 you can still add friends and use private chat.',
      'Veyra is private chat, for friends only. Pick a friend from your conversation list and chat one-to-one.',
      'Be kind and be careful: never share passwords, and never share your long account ID — your traveler code is the only code you need to share with other players.',
    ],
  },
  {
    id: 'referral',
    title: 'Referrals: inviting friends',
    icon: 'gift',
    go: '/referral',
    goLabel: 'Referral',
    body: [
      'Your referral code is your traveler code. Share your referral link, which looks like mythica.bond/signup?r=YOURCODE, or just share the code itself.',
      'A new traveler who enters your code at signup gets 50 Petals free on their new account. The bonus goes to the new account, not to you.',
      'You earn 10 Petals for every 100 Petals your referred travelers earn in total — counting their hunt and marketplace earnings only, not events, redeem codes or trades. It is cumulative, so small earnings add up toward the next 100.',
      'Your Referral page shows your code, your total referral income, how many travelers you invited, your latest 10 invited travelers, and your top 10 earners.',
      'One rule to know: if a referral claim fails at signup, there is no retry — the new traveler simply misses the 50 Petals. Enter the code carefully at signup.',
    ],
  },
  {
    id: 'redeem-codes',
    title: 'Redeem codes',
    icon: 'gift',
    go: '/profile',
    goLabel: 'Profile',
    body: [
      'Promo codes are redeemed from the Redeem Code section at the bottom of your Profile page.',
      'Each code can be used once per account, and codes may have a total usage limit or an expiry date. Rewards are granted instantly when a valid code is redeemed.',
      'If a code says it is invalid, already used, or expired, it cannot be redeemed again — codes are checked by the server, not by the page.',
    ],
  },
  {
    id: 'achievements',
    title: 'Achievements',
    icon: 'trophy',
    go: '/profile',
    goLabel: 'Profile',
    body: [
      'Achievements reward milestones with bonus XP. Firsts — your first hunt, first trade, first friend and first upgrade — are worth 100 XP each.',
      'Longer goals scale up: 100 and 500 hunts, 100 trades, a fully maxed weapon, and a 5,000,000-power Mythic weapon are among the big ones.',
      'There are also 4 hidden achievements. They show as “???” until you earn them — no spoilers here.',
      'Achievements follow the game’s easy-first, hard-later design: early ones come quickly, later ones take real work. That is intentional, so there is always a next goal.',
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: 'mail',
    go: '/dashboard',
    goLabel: 'Dashboard',
    body: [
      'The bell in the header, to the left of your Petal balance, collects your notifications. An unread badge shows how many you have not opened yet.',
      'Notifications are color-coded by kind: friend requests are blue, admin messages are red, event updates are gold, support replies are teal, and system updates are purple.',
      'You get a bell notification for friend requests, replies to your support tickets, and new events. Private Veyra messages arrive as device push notifications instead, not in the bell.',
    ],
  },
  {
    id: 'withdrawals',
    title: 'Withdrawals: turning Petals into money',
    icon: 'marketplace',
    go: '/withdraw',
    goLabel: 'Withdraw',
    body: [
      'Petals have real-world value: 1,000 Petals = $0.10, and the minimum withdrawal is $1, which is 10,000 Petals.',
      'To withdraw, open the Withdraw tab and request a withdrawal with your Binance UID and the number of Petals. The Petals are deducted from your balance immediately when you request.',
      'Withdrawals are reviewed manually. An admin checks your account and earning history before paying. If a request is rejected, your Petals are refunded automatically. If it is approved, the admin sends the USD to your Binance account manually and then marks it paid.',
      'Because review is manual, withdrawals are not instant. If your request is still pending, it is waiting for review — check the Withdraw tab for its status, or contact Support if something looks wrong.',
    ],
  },
  {
    id: 'profile-settings-safety',
    title: 'Profile, settings and staying safe',
    icon: 'settings',
    go: '/settings',
    goLabel: 'Settings',
    body: [
      'Your Profile shows your name, level, collection highlights, event medals, friends and achievements. It shows only your traveler code — never your long account ID.',
      'Settings lets you change your password (you must enter your current password, type the new one twice, and it must be at least 6 characters and different from the old one) and manage sound and notification preferences.',
      'Sign out lives inside the hamburger menu at the top-right. On mobile, the signed-in header shows your Petal balance first, with the hamburger at the far top-right.',
      'Signup only accepts verified email providers (Gmail, Outlook, Yahoo, Proton, iCloud and other major providers). If your email is rejected at signup, that is why.',
      'Stay safe: never share your password, never share verification codes, and never send Petals or items to someone promising to “double” them. Staff will never ask for your password.',
    ],
  },
  {
    id: 'tips',
    title: 'Tips from experienced travelers',
    icon: 'help',
    go: '/hunt',
    goLabel: 'Hunt',
    body: [
      'Hunt every day, even briefly. XP, materials and Petal finds compound — and every hunt moves you toward the next rarity unlock.',
      'Equip before you hunt. Your strongest weapon only helps if it is equipped; a stronger weapon sitting in Inventory does nothing for your drops.',
      'Upgrade your best weapon first, then merge its duplicates. Chasing a rarer weapon you cannot yet equip is slower than maxing the weapon you already have.',
      'Do not sell a weapon you might merge later. Check its star tier and the next unlock threshold before listing anything.',
      'Join every event you can. Event rewards and medals are time-limited — hunts and marketplace deals will still be there tomorrow.',
      'Invite friends early. Referral earnings grow quietly in the background as your friends hunt and trade, and friends also unlock Veyra chat and trades.',
      'Watch the Marketplace before you buy. Prices are set by players, and a quick search can save you hundreds of Petals.',
    ],
  },
];

const FAQS = [
  { q: 'What is the goal of Mythica?', a: 'Hunt sprites and weapons, grow your collection, upgrade your gear, trade with other travelers, and climb the leaderboard. The loop is Hunt → Collect → Upgrade → Trade → Rise.', tags: 'goal game what' },
  { q: 'How do I start playing?', a: 'Sign up, and you start with 20 Petals and a Worn Blade already equipped. Go to Hunt, tap Begin Hunt, then check Inventory for what you found.', tags: 'start new beginner first hunt signup' },
  { q: 'How long do I wait between hunts?', a: '10 seconds. The cooldown is enforced by the server, and the Hunt button shows a countdown until it unlocks.', tags: 'hunt cooldown wait 10 seconds delay' },
  { q: 'Why did my hunt find nothing?', a: 'Not every hunt drops an item — about 2 in 3 do — and Petal finds are occasional (3–12 Petals). Every hunt still grants 8–16 XP, so no hunt is wasted.', tags: 'hunt no drop empty nothing' },
  { q: 'What are Petals?', a: 'Petals are the game’s currency. Earn them from hunts, marketplace sales, events, referrals and redeem codes; spend them in the Marketplace; or withdraw them once you reach 10,000 Petals ($1).', tags: 'petals currency money earn spend' },
  { q: 'How does weapon power work?', a: 'Power = base × (1 + 0.5 × upgrade level) × 1.5^stars. Base power runs from 200 (Common) to 5,000,000 (Mythic). Only your equipped weapon’s power counts for hunt drops.', tags: 'weapon power formula upgrade stars' },
  { q: 'How do I unlock rarer drops?', a: 'Raise your equipped weapon’s power past the thresholds: Uncommon 2,000+, Rare 20,000+, Epic 200,000+, Legendary 1,500,000+, Mythic 5,000,000+. Your traveler level must also meet the item’s level gate (Rare 8, Epic 15, Legendary 25, Mythic 40).', tags: 'rarity unlock rare epic legendary mythic drop' },
  { q: 'What are weapon stars?', a: 'Stars come from merging duplicate copies of the same weapon, up to 6 stars. Each star multiplies power by 1.5.', tags: 'stars merge duplicates' },
  { q: 'How do I upgrade a weapon?', a: 'In Inventory, open the weapon’s upgrade view. It lists the exact materials and Petals needed and what you own. The button stays disabled until you have everything, and some materials only unlock as you level up.', tags: 'upgrade materials forge' },
  { q: 'How do I buy something in the Marketplace?', a: 'Open Marketplace, search by item name, check the price in Petals, and tap Buy. If you cannot afford it, the button will say so.', tags: 'marketplace buy purchase shop' },
  { q: 'How do I sell something?', a: 'Open Marketplace → Create Listing, pick a sellable item you own, set a quantity and a price in Petals. Your starter Worn Blade can never be sold.', tags: 'marketplace sell listing price' },
  { q: 'How do I trade with another player?', a: 'Get their traveler code (Trade ID), enter it in Trades, tap Find, pick your offered items, and send. Both sides confirm before the swap is sealed. Trades swap items only — no Petals.', tags: 'trade traveler code swap player' },
  { q: 'What is my traveler code / Trade ID?', a: 'It is the short code shown on your Profile. Share that code with other players for trades and referrals. Never share your long account ID.', tags: 'traveler code trade id profile' },
  { q: 'How do events work?', a: 'Join an event in Events, complete its objective (for example a number of hunts or invites), and claim the reward before it ends. Some events award Gold, Silver or Bronze medals shown on your Profile.', tags: 'event medal challenge reward' },
  { q: 'How does the leaderboard work?', a: 'It ranks travelers by their strongest weapon’s power: a Global Top 20 plus Your League (you with 5 above and 5 below). Upgrading, merging and equipping your best weapon is how you climb.', tags: 'leaderboard rank top power' },
  { q: 'How do I chat with other players?', a: 'Agora is public chat — you need level 10 to send messages, but you can read it earlier. Veyra is private chat for friends only. Add friends from a traveler’s profile in Agora.', tags: 'chat agora veyra friends talk' },
  { q: 'How do referrals work?', a: 'Share your traveler code as a referral link (mythica.bond/signup?r=YOURCODE). A new player entering it at signup gets 50 Petals, and you earn 10 Petals per 100 Petals they earn from hunts and marketplace sales. If the signup claim fails, there is no retry.', tags: 'referral invite friend bonus code' },
  { q: 'How do I redeem a promo code?', a: 'Enter it in the Redeem Code section at the bottom of your Profile. Each code works once per account and may expire or run out of uses.', tags: 'redeem code promo coupon' },
  { q: 'How do withdrawals work?', a: '1,000 Petals = $0.10, minimum $1 (10,000 Petals). Request in the Withdraw tab with your Binance UID; Petals are deducted immediately, an admin reviews manually, a rejection refunds you, and an approval is paid manually via Binance.', tags: 'withdraw money binance payout cash' },
  { q: 'Can I change my display name?', a: 'No — display names cannot be edited in Settings, so choose carefully at signup.', tags: 'name change display profile' },
  { q: 'How do I change my password?', a: 'In Settings, use the Change password card: enter your current password, type the new password twice (at least 6 characters, different from the old one).', tags: 'password change settings account' },
  { q: 'What do the notification colors mean?', a: 'In the bell by your Petal balance: blue = friend request, red = admin message, gold = event update, teal = support reply, purple = system update. Private messages arrive as device push, not in the bell.', tags: 'notification bell colors' },
  { q: 'Why can’t I send messages in Agora?', a: 'You need level 10 to send in Agora. Below level 10 you can read it, add friends, and use Veyra private chat with friends.', tags: 'agora level 10 chat send blocked' },
  { q: 'I need help with my account. What do I do?', a: 'Open Support from the dashboard or menu, describe the problem, and you will get a support ID. Your ticket history and replies live in the Support tab.', tags: 'support help problem contact ticket' },
];

function norm(s) {
  return (s || '').toLowerCase();
}

function scoreText(text, tokens) {
  const t = norm(text);
  let score = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) score += 1;
  }
  return score;
}

export default function GuidePage() {
  return (
    <Protected>
      <GuideInner />
    </Protected>
  );
}

function GuideInner() {
  const [query, setQuery] = useState('');
  const [openFaq, setOpenFaq] = useState(null);

  const tokens = useMemo(
    () => norm(query).split(/\s+/).map((t) => t.trim()).filter(Boolean),
    [query]
  );
  const searching = tokens.length > 0;

  const matchedChapters = useMemo(() => {
    if (!searching) return CHAPTERS;
    return CHAPTERS.map((c) => ({
      ...c,
      origIndex: CHAPTERS.indexOf(c),
      score: scoreText(c.title, tokens) * 3 + scoreText(c.body.join(' '), tokens),
    }))
      .filter((c) => c.score >= tokens.length)
      .sort((a, b) => b.score - a.score);
  }, [searching, tokens]);

  const matchedFaqs = useMemo(() => {
    if (!searching) return FAQS;
    return FAQS.map((f, i) => ({
      ...f,
      index: i,
      score: scoreText(f.q, tokens) * 3 + scoreText(`${f.a} ${f.tags}`, tokens),
    }))
      .filter((f) => f.score >= tokens.length)
      .sort((a, b) => b.score - a.score);
  }, [searching, tokens]);

  return (
    <div className="page">
      <h1 className="serif">The Mythica Player’s Guide</h1>
      <p style={{ color: 'var(--ink-dim)', maxWidth: '46rem' }}>
        Everything a traveler needs: what the game is, how to play, and how
        every system works — hunting, weapons, rarity, stars, upgrades, the
        Marketplace, trades, events, friends, referrals, withdrawals and more.
        Use the index to jump to a chapter, or type your question below and
        the guide and FAQ will filter in real time.
      </p>

      <div className="toolbar" style={{ marginTop: '1rem' }}>
        <label htmlFor="guide-search" style={{ fontWeight: 600 }}>
          <Icon name="search" /> Ask the guide
        </label>
        <input
          id="guide-search"
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type your question… e.g. how do I unlock Rare drops?"
          style={{ flex: 1, minWidth: '220px' }}
          aria-label="Search the guide and FAQ"
        />
        {query && (
          <button type="button" className="btn btn-ghost" onClick={() => { setQuery(''); sfx.click(); }}>
            Clear
          </button>
        )}
      </div>
      {searching && (
        <p style={{ color: 'var(--ink-dim)' }} role="status">
          {matchedChapters.length} chapter{matchedChapters.length === 1 ? '' : 's'} and{' '}
          {matchedFaqs.length} FAQ answer{matchedFaqs.length === 1 ? '' : 's'} match
          “{query}”.
          {matchedChapters.length === 0 && matchedFaqs.length === 0 && (
            <>
              {' '}Nothing matched — try fewer words, or{' '}
              <a href={link('/support')}>contact Support</a>.
            </>
          )}
        </p>
      )}

      <section className="card" style={{ padding: '1.25rem 1.25rem 0.5rem', background: 'linear-gradient(160deg, rgba(232, 179, 75, 0.10), rgba(232, 179, 75, 0.02) 55%, transparent)' }}>
        <h2 className="serif" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon name="scroll" /> Index
        </h2>
        <p style={{ color: 'var(--ink-dim)', marginTop: 0 }}>
          Tap a chapter to jump straight to it.
        </p>
        {matchedChapters.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)' }}>No chapters match your search.</p>
        ) : (
          <div className="grid-cards" style={{ paddingBottom: '0.75rem' }}>
            {matchedChapters.map((c) => {
              const num = (c.origIndex ?? CHAPTERS.indexOf(c)) + 1;
              return (
                <a
                  key={c.id}
                  href={`#${c.id}`}
                  onClick={() => sfx.click()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.7rem 0.9rem', borderRadius: 'var(--radius)',
                    border: '1px solid var(--line)', background: 'var(--bg-card)',
                    color: 'var(--ink)', textDecoration: 'none',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flex: '0 0 auto', width: '2rem', height: '2rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '50%', background: 'var(--gold, #e8b34b)',
                      color: '#1a1405', fontWeight: 700, fontSize: '0.9rem',
                    }}
                  >
                    {num}
                  </span>
                  <span style={{ color: 'var(--gold-soft, #d8b36a)', flex: '0 0 auto' }}>
                    <Icon name={c.icon} size="1.25em" />
                  </span>
                  <span>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Chapter {num}
                    </span>
                    <span style={{ fontWeight: 600 }}>{c.title}</span>
                  </span>
                </a>
              );
            })}
            <a
              href="#faq"
              onClick={() => sfx.click()}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.7rem 0.9rem', borderRadius: 'var(--radius)',
                border: '1px solid var(--gold, #e8b34b)', background: 'rgba(232, 179, 75, 0.12)',
                color: 'var(--ink)', textDecoration: 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: '0 0 auto', width: '2rem', height: '2rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%', background: 'var(--gold, #e8b34b)',
                  color: '#1a1405', fontWeight: 700, fontSize: '0.9rem',
                }}
              >
                ?
              </span>
              <span style={{ color: 'var(--gold-soft, #d8b36a)', flex: '0 0 auto' }}>
                <Icon name="help" size="1.25em" />
              </span>
              <span>
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Quick answers
                </span>
                <span style={{ fontWeight: 600 }}>Frequently asked questions</span>
              </span>
            </a>
          </div>
        )}
      </section>

      {matchedChapters.map((c, i) => (
        <section key={c.id} id={c.id} className="card" style={{ marginTop: '1rem', scrollMarginTop: '5rem' }}>
          <h2 className="serif" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Icon name={c.icon} /> {searching ? c.title : `Chapter ${i + 1}: ${c.title}`}
          </h2>
          {c.body.map((p, j) => (
            <p key={j} style={{ color: j === 0 ? 'inherit' : 'var(--ink-dim)' }}>{p}</p>
          ))}
          <a className="btn btn-ghost" href={link(c.go)} onClick={() => sfx.click()}>
            Go to {c.goLabel} →
          </a>
        </section>
      ))}

      <section id="faq" className="card" style={{ marginTop: '1.5rem', scrollMarginTop: '5rem' }}>
        <h2 className="serif">Frequently asked questions</h2>
        <p style={{ color: 'var(--ink-dim)' }}>
          Tap a question to reveal its answer. The search box above filters
          these answers as you type.
        </p>
        {matchedFaqs.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)' }}>
            No FAQ answers match. Try different words, or{' '}
            <a href={link('/support')}>contact Support</a>.
          </p>
        ) : (
          matchedFaqs.map((f) => {
            const key = f.index ?? FAQS.indexOf(f);
            const open = openFaq === key;
            return (
              <div key={key} style={{ borderTop: '1px solid var(--line)', padding: '0.6rem 0' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                  aria-expanded={open}
                  onClick={() => { setOpenFaq(open ? null : key); sfx.click(); }}
                >
                  {open ? '▾' : '▸'} {f.q}
                </button>
                {open && <p style={{ margin: '0.4rem 0 0.2rem 1.5rem', color: 'var(--ink-dim)' }}>{f.a}</p>}
              </div>
            );
          })
        )}
      </section>

      <p style={{ color: 'var(--ink-dim)', marginTop: '1.5rem' }}>
        Still stuck? <a href={link('/support')}>Contact Support</a> from the
        dashboard or the menu — describe what happened and you will get a
        support ID to follow up on.
      </p>
    </div>
  );
}

'use client';
// Shared icon pack — Lucide (ISC-licensed, free for commercial use).
// Replaces emoji glyphs with crisp SVG icons across the game UI.
import {
  Flower2, Moon, TreePine, Sword, Swords, Handshake, Sparkles, Backpack,
  Coins, Landmark, Mail, Search, Gift, PartyPopper, CircleCheck, TriangleAlert,
  Check, X, Plus, Ticket, CloudMoon, PawPrint, Leaf, TrendingUp, Star, Tag,
  CircleHelp, Inbox, Send, Tent, Gamepad2, ScrollText, Waves, Medal, Lock,
  Settings, Lightbulb, Hand, Menu, ArrowUp, CalendarDays, Users, ShoppingBag,
  ArrowLeftRight, User, Bell, ChevronDown, Info, Clock, Trophy, Zap,
} from 'lucide-react';

const MAP = {
  petals: Flower2,      // 🌸 currency
  moon: Moon,           // 🌙 hunt / brand
  forest: TreePine,     // 🌲
  sword: Sword,         // 🗡️
  swords: Swords,       // ⚔️ weapon type
  trades: Handshake,    // 🤝
  sparkles: Sparkles,   // ✨ XP
  inventory: Backpack,  // 🎒
  marketplace: Coins,   // 🪙
  agora: Landmark,      // 🏛️
  mail: Mail,           // ✉️ Veyra
  search: Search,       // 🔍
  gift: Gift,           // 🎁
  party: PartyPopper,   // 🎉
  success: CircleCheck, // ✅
  warning: TriangleAlert, // ⚠️
  check: Check,         // ✓
  close: X,             // ✕ ✗
  plus: Plus,           // ➕
  ticket: Ticket,       // 🎟️ redeem
  sleep: CloudMoon,     // 😴 hunt cooldown
  paw: PawPrint,        // 🐾
  leaf: Leaf,           // 🍂 empty state
  levelup: TrendingUp,  // ⬆
  star: Star,           // ★ favorite
  tag: Tag,             // 🏷️ listings
  help: CircleHelp,     // ❓
  inbox: Inbox,         // 📨 incoming
  send: Send,           // 📤 outgoing
  events: Tent,         // 🎪
  gamepad: Gamepad2,    // 🕹️ mini-game
  scroll: ScrollText,   // 📜
  waves: Waves,         // 🌊 decorative
  medal: Medal,         // 🏅 achievements
  lock: Lock,           // 🔒
  settings: Settings,   // ⚙️
  tip: Lightbulb,       // 💡
  wave: Hand,           // 👋
  menu: Menu,           // ☰
  up: ArrowUp,
  calendar: CalendarDays,
  users: Users,
  shop: ShoppingBag,
  swap: ArrowLeftRight,
  user: User,
  bell: Bell,
  chevronDown: ChevronDown,
  info: Info,
  clock: Clock,
  trophy: Trophy,
  zap: Zap,
};

// Inline SVG icon sized to the surrounding text. Use <Icon name="petals" />
// anywhere an emoji glyph was previously used.
export function Icon({ name, size = '1em', className, style, strokeWidth = 2 }) {
  const Cmp = MAP[name] || MAP.help;
  return (
    <Cmp
      size={size}
      className={className}
      strokeWidth={strokeWidth}
      style={{ verticalAlign: '-0.12em', ...style }}
      aria-hidden="true"
    />
  );
}

// Large display icon for EmptyState and feature cards.
export function BigIcon({ name, size = '2.2rem', style }) {
  const Cmp = MAP[name] || MAP.moon;
  return <Cmp size={size} strokeWidth={1.6} style={{ ...style }} aria-hidden="true" />;
}

export const iconNames = Object.keys(MAP);

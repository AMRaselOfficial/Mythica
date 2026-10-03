import content from './content.js';

// XP to advance from level n to n+1 = floor(base * n^growth)  (contract §1)
export function xpForLevel(n) {
  const { base, growth } = content.xpCurve;
  return Math.floor(base * Math.pow(n, growth));
}

export function xpProgress(level, xp) {
  const need = xpForLevel(level);
  return { need, pct: need > 0 ? Math.min(100, (xp / need) * 100) : 100 };
}

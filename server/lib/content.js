'use strict';
/**
 * Content loading + lookups. Data-driven: everything comes from the content
 * JSON (CONTENT_PATH env, default <server dir>/../content/STUB-content.json).
 * Never hardcode item IDs here.
 */
const fs = require('fs');
const path = require('path');

const CONTENT_PATH =
  process.env.CONTENT_PATH ||
  path.join(__dirname, '..', '..', 'content', 'STUB-content.json');

let content;
try {
  content = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
} catch (e) {
  throw new Error(`mythica-server: failed to load content from ${CONTENT_PATH}: ${e.message}`);
}

function getItem(id) {
  return content.items.find((i) => i.id === id) || null;
}

/** Items eligible for hunt drops: active and with positive drop weight. */
function activeDropPool() {
  return content.items.filter((i) => i.active && (i.dropWeight || 0) > 0);
}

/** XP to advance from level n to n+1 = floor(base * n^growth). */
function xpForLevel(n) {
  const c = content.xpCurve;
  return Math.floor(c.base * Math.pow(n, c.growth));
}

/** Petals to go from upgrade `level` to `level + 1`; null when not upgradeable. */
function upgradeCost(item, level) {
  if (!item || !item.upgradeable) return null;
  const costs = item.upgradeCosts || [];
  return costs[level] !== undefined ? costs[level] : null;
}

function cooldownMs() {
  return (content.hunt.cooldownSec || 60) * 1000;
}

function startingPetals() {
  return content.settings.startingPetals ?? 20;
}

module.exports = {
  content,
  CONTENT_PATH,
  getItem,
  activeDropPool,
  xpForLevel,
  upgradeCost,
  cooldownMs,
  startingPetals,
};

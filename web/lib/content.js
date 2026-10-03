import content from '../../content/mythica-content.json';

// Single data-driven content source: the full game content.
// (content/STUB-content.json remains as a minimal schema example for dev.)
export default content;

export function rarityColor(rarityId) {
  const r = content.rarities.find((x) => x.id === rarityId);
  return r ? r.color : '#9aa3b2';
}

export function itemById(itemId) {
  return content.items.find((x) => x.id === itemId);
}

export function activeItems() {
  return content.items.filter((x) => x.active !== false);
}

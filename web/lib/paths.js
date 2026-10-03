// Helpers to prefix the Pages basePath onto internal links and asset URLs.
const BASE = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BASE_PATH) || '';

/** Prefix an asset path with the basePath: asset('assets/sprites/ember-fox.webp') */
export function asset(p) {
  const clean = String(p || '').replace(/^\//, '');
  return BASE ? `${BASE}/${clean}` : `/${clean}`;
}

/** Prefix an internal route with the basePath: link('/hunt') */
export function link(p) {
  const clean = String(p || '');
  if (!clean.startsWith('/')) return clean;
  return BASE ? `${BASE}${clean}` : clean;
}

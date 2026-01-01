export function normalizeUrl(url) {
  return url.replace(/\s+/g, '').replace(/\/?$/, '');
}

export function ensureJsonUrl(url) {
  return url.includes('?') ? `${url}&f=json` : `${url}?f=json`;
}

export function joinUrl(...parts) {
  return parts
  .filter(Boolean)
  .map((part, idx) => {
    if (idx === 0) return part.replace(/\/+$/, '');
    return part.replace(/^\/+|\/+$/g, '');
  })
  .join('/');
}


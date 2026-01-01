export function slugify(value) {
  const slug = (value || '')
	.toString()
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/^-+|-+$/g, '')
	.slice(0, 80);
  return slug || 'layer';
}

export function buildUniqueSlugs(layers) {
  const counts = new Map();
  return layers.map(layer => {
	const base = slugify(layer.name || 'layer');
	const next = (counts.get(base) || 0) + 1;
	counts.set(base, next);
	return next === 1 ? base : `${base}-${next}`;
  });
}
export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`);
  return res.json();
}

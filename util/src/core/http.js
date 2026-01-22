export async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    const error = new Error(`Network error while requesting ${url}`);
    error.isNetworkError = true;
    error.url = url;
    error.cause = err;
    throw error;
  }
  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch (err) {
      bodyText = '';
    }
    const error = new Error(`Request failed (${res.status}) for ${url}`);
    error.status = res.status;
    error.statusText = res.statusText;
    error.url = url;
    error.bodyText = bodyText;
    throw error;
  }
  return res.json();
}

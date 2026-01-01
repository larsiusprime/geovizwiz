import { normalizeUrl, ensureJsonUrl, joinUrl } from "../core/url.js";
import { fetchJson } from "../core/http.js";

export function getLayerUrl(layer) {
  return `${layer.serviceUrl.replace(/\/?$/, '')}/${layer.id}`;
}

export function buildServiceUrl(directoryUrl, service) {
  const base = normalizeUrl(directoryUrl);
  let servicePath = service.name || '';
  const servicesMarker = '/services/';
  const markerIndex = base.toLowerCase().indexOf(servicesMarker);
  if (markerIndex !== -1) {
    const folderPath = base.slice(markerIndex + servicesMarker.length);
    if (folderPath && servicePath.toLowerCase().startsWith(`${folderPath.toLowerCase()}/`)) {
      servicePath = servicePath.slice(folderPath.length + 1);
    }
  }
  return joinUrl(base, servicePath, service.type);
}

export async function fetchLayerMetadata(serviceUrl, layerId) {
  const url = `${serviceUrl.replace(/\/?$/, '')}/${layerId}`;
  const data = await fetchJson(ensureJsonUrl(url));
  return { info: data, url };
}

export async function fetchLayerPreview(serviceUrl, layerId) {
  const { info, url } = await fetchLayerMetadata(serviceUrl, layerId);
  let count = null;
  try {
    const countUrl = `${url}/query?where=1%3D1&returnCountOnly=true&f=json`;
    const countInfo = await fetchJson(countUrl);
    count = Number.isFinite(countInfo.count) ? countInfo.count : null;
  } catch (err) {
    console.warn('Preview count failed', err);
  }
  return { info, url, count };
}

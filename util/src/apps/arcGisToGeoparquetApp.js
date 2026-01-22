import { normalizeUrl, ensureJsonUrl, joinUrl } from "../core/url.js"
import { fetchJson } from "../core/http.js"
import { slugify, buildUniqueSlugs } from "../core/names.js"
import { triggerDownload } from "../export/download.js"
import { buildZipBlob } from "../export/zip.js"
import { arcgisGeometryToGeoJSON } from "../geo/esriGeometry.js"
import { createGeoMetadata, getProjJSONForEPSG, mapGeometryType } from "../geo/geoparquetMeta.js"
import { createGeoParquetBlob } from "../parquet/geoparquetWriter.js";
import {
  getLayerUrl,
  buildServiceUrl,
  fetchLayerMetadata,
  fetchLayerPreview
} from "../arcgis/api.js";

import initParquetWasm, {
  Table as WasmTable,
  writeParquet,
  WriterPropertiesBuilder,
  Compression
} from '../../vendor/parquet-wasm/esm/parquet_wasm.js';

export default async function startArcgisToGeoparquetApp() {
    await initParquetWasm();
  
    const page1 = document.getElementById('page1');
    const page2 = document.getElementById('page2');
    const page3 = document.getElementById('page3');
    const endpointInput = document.getElementById('endpoint');
    const endpointStatus = document.getElementById('endpointStatus');
    const layerTree = document.getElementById('layerTree');
    const layerSelectBtn = document.getElementById('layerSelectBtn');
    const previewLayerBtn = document.getElementById('previewLayerBtn');
    const layerStatus = document.getElementById('layerStatus');
    const previewPanel = document.getElementById('previewPanel');
    const previewContent = document.getElementById('previewContent');
    const downloadHeadline = document.getElementById('downloadHeadline');
    const downloadProgress = document.getElementById('downloadProgress');
    const downloadDetail = document.getElementById('downloadDetail');
    const queueList = document.getElementById('queueList');
    const startDownloadBtn = document.getElementById('startDownloadBtn');
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const metadataPanel = document.getElementById('metadataPanel');
    const metadataContent = document.getElementById('metadataContent');
    const metadataCloseBtn = document.getElementById('metadataCloseBtn');
    const breadcrumbNav = document.getElementById('breadcrumbNav');
    const breadcrumbButtons = Array.from(breadcrumbNav.querySelectorAll('.breadcrumb'));
    const exportStatus = document.getElementById('exportStatus');
    const logEl = document.getElementById('log');
  
    let serviceInfo = null;
    let selectedLayers = [];
    let queuedLayers = [];
    let downloadInProgress = false;
    let currentStep = 1;
    let maxVisitedStep = 1;
  
    function log(msg) {
      const line = document.createElement("div");
      line.textContent = msg;
      document.getElementById("log").appendChild(line);
    }

    function buildFetchErrorMessage(err) {
      const status = err?.status;
      const bodyText = (err?.bodyText || '').toLowerCase();
      const isAuthKeyword = /authentication required|unauthorized|login required|token required|invalid token/.test(bodyText);
      const hasRefererKeyword = /referer|referrer/.test(bodyText);

      if (status === 401 || isAuthKeyword) {
        return 'This endpoint requires authentication. This app only fetches from unauthenticated endpoints, so it cannot access this service.';
      }

      if (status === 403 && hasRefererKeyword) {
        return 'This endpoint requires a Referer header. This app runs entirely locally and cannot send custom Referer headers, so it cannot access this service.';
      }

      if (err?.isNetworkError || /failed to fetch/i.test(err?.message || '')) {
        return 'Unable to reach this endpoint from the browser. The server may be blocking cross-origin requests or the network is unavailable.';
      }

      if (status === 404) {
        return 'The endpoint was not found (404). Double-check the URL and try again.';
      }

      if (status) {
        const statusLabel = err?.statusText ? ` ${err.statusText}` : '';
        return `Request failed with status ${status}${statusLabel}.`;
      }

      return err?.message || 'An unexpected error occurred while contacting the service.';
    }

    function formatFetchError(err, context) {
      const message = buildFetchErrorMessage(err);
      return context ? `${context}: ${message}` : message;
    }
    
    function buildLayerTree(layers = [], tables = [], serviceUrl) {
      const container = document.createElement('div');
      const buildNodes = (items) => {
        const ul = document.createElement('ul');
        ul.className = 'tree';
        items.forEach(item => {
          const li = document.createElement('li');
          const row = document.createElement('div');
          row.className = 'layer-row';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'layer-checkbox';
          checkbox.value = item.id;
          checkbox.dataset.layerId = item.id;
          checkbox.dataset.layerName = item.name || `Layer ${item.id}`;
          checkbox.dataset.serviceUrl = serviceUrl;
          checkbox.addEventListener('change', () => {
            updateSelectedLayers();
          });
          const label = document.createElement('label');
          label.textContent = `${item.name} (id: ${item.id})`;
          label.style.fontWeight = '400';
          row.appendChild(checkbox);
          row.appendChild(label);
          li.appendChild(row);
          if (Array.isArray(item.subLayerIds) && item.subLayerIds.length) {
            const details = document.createElement('details');
            details.open = false;
            const summary = document.createElement('summary');
            summary.textContent = `Children (${item.subLayerIds.length})`;
            details.appendChild(summary);
            const children = item.subLayerIds
              .map(id => layers.find(l => l.id === id))
              .filter(Boolean);
            details.appendChild(buildNodes(children));
            li.appendChild(details);
          }
          ul.appendChild(li);
        });
        return ul;
      };
  
      const layerList = document.createElement('details');
      layerList.open = true;
      const summaryLayers = document.createElement('summary');
      summaryLayers.textContent = `Layers (${layers.length})`;
      layerList.appendChild(summaryLayers);
      layerList.appendChild(buildNodes(layers));
      container.appendChild(layerList);
  
      if (tables.length) {
        const tableList = document.createElement('details');
        tableList.open = true;
        const summaryTables = document.createElement('summary');
        summaryTables.textContent = `Tables (${tables.length})`;
        tableList.appendChild(summaryTables);
        tableList.appendChild(buildNodes(tables));
        container.appendChild(tableList);
      }
      return container;
    }
  
    function buildDirectoryTree(directoryUrl, info = {}) {
      const container = document.createElement('div');
      const folders = info.folders || [];
      const services = info.services || [];
  
      if (folders.length) {
        const folderList = document.createElement('details');
        folderList.open = true;
        const summaryFolders = document.createElement('summary');
        summaryFolders.textContent = `Folders (${folders.length})`;
        folderList.appendChild(summaryFolders);
        const ul = document.createElement('ul');
        ul.className = 'tree';
        folders.forEach(folder => {
          const li = document.createElement('li');
          const details = document.createElement('details');
          details.open = false;
          const summary = document.createElement('summary');
          summary.textContent = folder;
          details.appendChild(summary);
          const content = document.createElement('div');
          content.className = 'muted';
          content.textContent = 'Expand to load folder...';
          details.appendChild(content);
          let loaded = false;
          details.addEventListener('toggle', async () => {
            if (!details.open || loaded) return;
            loaded = true;
            content.textContent = 'Loading folder...';
            try {
              const folderUrl = joinUrl(directoryUrl, folder);
              const data = await fetchJson(ensureJsonUrl(folderUrl));
              const subtree = buildDirectoryTree(folderUrl, data);
              content.replaceWith(subtree);
            } catch (err) {
              content.textContent = formatFetchError(err, 'Failed to load folder');
            }
          });
          li.appendChild(details);
          ul.appendChild(li);
        });
        folderList.appendChild(ul);
        container.appendChild(folderList);
      }
  
      if (services.length) {
        const serviceList = document.createElement('details');
        serviceList.open = true;
        const summaryServices = document.createElement('summary');
        summaryServices.textContent = `Services (${services.length})`;
        serviceList.appendChild(summaryServices);
        const ul = document.createElement('ul');
        ul.className = 'tree';
        services.forEach(service => {
          const li = document.createElement('li');
          const details = document.createElement('details');
          details.open = false;
          const label = (service.name || '').split('/').pop() || 'Service';
          const summary = document.createElement('summary');
          summary.textContent = `${label} (${service.type || 'Service'})`;
          details.appendChild(summary);
          const content = document.createElement('div');
          content.className = 'muted';
          content.textContent = 'Expand to load layers...';
          details.appendChild(content);
          let loaded = false;
          details.addEventListener('toggle', async () => {
            if (!details.open || loaded) return;
            loaded = true;
            content.textContent = 'Loading layers...';
            try {
              const serviceUrl = buildServiceUrl(directoryUrl, service);
              const data = await fetchJson(ensureJsonUrl(serviceUrl));
              const layers = data.layers || [];
              const tables = data.tables || [];
              if (!layers.length && !tables.length) {
                content.textContent = 'No layers or tables found.';
                return;
              }
              const tree = buildLayerTree(layers, tables, serviceUrl);
              content.replaceWith(tree);
              updateSelectedLayers();
            } catch (err) {
              content.textContent = formatFetchError(err, 'Failed to load service');
            }
          });
          li.appendChild(details);
          ul.appendChild(li);
        });
        serviceList.appendChild(ul);
        container.appendChild(serviceList);
      }
  
      if (!folders.length && !services.length) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'No folders or services found.';
        container.appendChild(empty);
      }
  
      return container;
    }

  
    function updateSelectedLayers() {
      const checkboxes = Array.from(layerTree.querySelectorAll('.layer-checkbox'));
      selectedLayers = checkboxes
        .filter(cb => cb.checked)
        .map(cb => {
          const layerId = Number.parseInt(cb.dataset.layerId, 10);
          const layerName = cb.dataset.layerName;
          const serviceUrl = cb.dataset.serviceUrl;
          const layer = { id: Number.isNaN(layerId) ? cb.dataset.layerId : layerId, name: layerName, serviceUrl };
          return {
            ...layer,
            layerUrl: getLayerUrl(layer)
          };
        });
  
      const hasSelection = selectedLayers.length > 0;
      const hasLayers = checkboxes.length > 0;
      layerSelectBtn.disabled = !hasSelection;
      previewLayerBtn.disabled = !hasSelection;
      if (!hasSelection) {
        previewPanel.classList.add('hidden');
        previewContent.innerHTML = '';
      }
    }

    function resetStep3State() {
      queuedLayers = [];
      downloadInProgress = false;
      queueList.innerHTML = '';
      downloadProgress.style.width = '0%';
      downloadDetail.textContent = '';
      downloadHeadline.textContent = '';
      exportStatus.textContent = '';
      metadataPanel.classList.add('hidden');
      metadataContent.innerHTML = '';
      logEl.innerHTML = '';
      updateQueueControls();
    }

    function setStep(step) {
      currentStep = step;
      page1.classList.toggle('hidden', step !== 1);
      page2.classList.toggle('hidden', step !== 2);
      page3.classList.toggle('hidden', step !== 3);
      breadcrumbButtons.forEach(btn => {
        const target = Number.parseInt(btn.dataset.step, 10);
        const isAvailable = target <= maxVisitedStep;
        btn.disabled = !isAvailable;
        btn.classList.toggle('current', target === currentStep);
      });
    }

    function updateMaxVisited(step) {
      maxVisitedStep = Math.max(maxVisitedStep, step);
      setStep(step);
    }
  
    
    function attachEndpointHandler() {
      document.getElementById('endpointLoadBtn').addEventListener('click', async () => {
        const rawUrl = endpointInput.value.trim();
        if (!rawUrl) {
          endpointStatus.textContent = 'Please provide an ArcGIS REST endpoint.';
          return;
        }
        const url = normalizeUrl(rawUrl);
        endpointStatus.textContent = 'Loading service info...';
        layerStatus.textContent = '';
        layerSelectBtn.disabled = true;
        previewLayerBtn.disabled = true;
        previewPanel.classList.add('hidden');
        previewContent.innerHTML = '';
        selectedLayers = [];
        resetStep3State();
        try {
          const info = await fetchJson(ensureJsonUrl(url));
          if (!info.layers && !info.services && !info.folders && !info.tables) {
            throw new Error('No layers or services found at this endpoint.');
          }
          serviceInfo = info;
          layerTree.innerHTML = '';
          if (info.layers || info.tables) {
            const layers = info.layers || [];
            const tables = info.tables || [];
            layerTree.appendChild(buildLayerTree(layers, tables, url));
            endpointStatus.textContent = 'Service loaded. Expand and choose a layer.';
            updateSelectedLayers();
          } else {
            layerTree.appendChild(buildDirectoryTree(url, info));
            endpointStatus.textContent = 'Service directory loaded. Expand folders and services.';
          }
          maxVisitedStep = 2;
          setStep(2);
        } catch (err) {
          console.error(err);
          endpointStatus.textContent = formatFetchError(err, 'Failed to load service');
        }
      });
    }
  
    function buildPreviewMarkup(preview) {
      const { info, count } = preview;
      const fieldsCount = Array.isArray(info.fields) ? info.fields.length : 0;
      const geometryLabel = info.geometryType ? mapGeometryType(info.geometryType) : 'None';
      const layerType = info.type || (info.geometryType ? 'Feature Layer' : 'Table');
      const countLabel = Number.isFinite(count) ? count.toLocaleString() : 'Unavailable';
      const fields = Array.isArray(info.fields) ? info.fields : [];
      const fieldRows = fields.map(field => {
        const alias = field.alias ? ` (${field.alias})` : '';
        const length = field.length ? `Length: ${field.length}` : null;
        const nullable = typeof field.nullable === 'boolean' ? (field.nullable ? 'Nullable' : 'Required') : null;
        const extras = [length, nullable].filter(Boolean).join(' · ');
        return `
          <tr>
            <td>${field.name || 'Unknown'}${alias}</td>
            <td>${field.type || 'Unknown'}</td>
            <td>${extras || '—'}</td>
          </tr>
        `;
      }).join('');
  
      return `
        <div class="preview-summary" role="table" aria-label="Layer summary">
          <table>
            <thead>
              <tr>
                <th scope="col">Layer name</th>
                <th scope="col">Layer type</th>
                <th scope="col">Geometry type</th>
                <th scope="col">Total rows</th>
                <th scope="col">Fields</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${info.name || 'Unknown'}</td>
                <td>${layerType}</td>
                <td>${geometryLabel}</td>
                <td>${countLabel}</td>
                <td>${fieldsCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="preview-fields" role="table" aria-label="Field list">
          ${fields.length ? `
          <table>
            <thead>
              <tr>
                <th scope="col">Field name</th>
                <th scope="col">Type</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              ${fieldRows}
            </tbody>
          </table>
          ` : '<div class="empty">No field information available.</div>'}
        </div>
      `;
    }
  
    const _projjsonCache = new Map();
  
  
    async function fetchAllFeatures(layerUrl, layerInfo, onProgress) {
      const maxRecordCount = layerInfo.maxRecordCount || 1000;
      const countUrl = `${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`;
      const countInfo = await fetchJson(countUrl);
      const total = countInfo.count || 0;
      const collectedFeatures = [];
      const collectedFields = layerInfo.fields || [];
      const layerSpatialRef = layerInfo.extent?.spatialReference || layerInfo.spatialReference;
      let fetched = 0;
      let offset = 0;
  
      while (offset < total) {
        const outSR = layerSpatialRef?.latestWkid || layerSpatialRef?.wkid;
        const queryUrl = `${layerUrl}/query?where=1%3D1&outFields=*&returnGeometry=true&f=json&resultOffset=${offset}&resultRecordCount=${maxRecordCount}${outSR ? `&outSR=${outSR}` : ""}`;
        const data = await fetchJson(queryUrl);
        const features = data.features || [];
        features.forEach(f => {
          const geojson = arcgisGeometryToGeoJSON(f.geometry, layerInfo.geometryType);
          const wkb = geojson ? wkx.Geometry.parseGeoJSON(geojson).toWkb() : null;
          collectedFeatures.push({ attributes: f.attributes, geometry: (wkb && wkb.length) ? wkb : null });
        });
        fetched += features.length;
        offset += maxRecordCount;
        const pct = total ? Math.min(100, Math.round((fetched / total) * 100)) : 100;
        if (onProgress) {
          onProgress({ fetched, total, pct });
        }
        log(`Fetched batch ending at offset ${offset}`);
        if (!features.length) break;
      }
      return { features: collectedFeatures, fields: collectedFields, spatialRef: layerSpatialRef };
    }
    
  
    function buildQueueFromSelection() {
        const slugs = buildUniqueSlugs(selectedLayers);
      queuedLayers = selectedLayers.map((layer, idx) => ({
        id: layer.id,
        name: layer.name,
        serviceUrl: layer.serviceUrl,
        fullName: layer.name,
        layerUrl: layer.layerUrl,
        enabled: true,
        status: 'pending',
        slug: slugs[idx],
        blob: null,
        info: null,
        error: null
      }));
    }
  
    function updateQueueControls() {
      const enabledCount = queuedLayers.filter(item => item.enabled).length;
      const readyCount = queuedLayers.filter(item => item.enabled && item.status === 'ready').length;
      startDownloadBtn.disabled = !enabledCount || downloadInProgress;
      downloadAllBtn.disabled = !(enabledCount && readyCount === enabledCount);
    }
  
    function updateOverallProgress() {
      const enabledItems = queuedLayers.filter(item => item.enabled);
      if (!enabledItems.length) {
        downloadProgress.style.width = '0%';
        downloadDetail.textContent = '';
        downloadHeadline.textContent = '';
        return;
      }
      const completed = enabledItems.filter(item => item.status === 'ready').length;
      const pct = Math.round((completed / enabledItems.length) * 100);
      downloadProgress.style.width = `${pct}%`;
      downloadDetail.textContent = `${completed} of ${enabledItems.length} layers ready.`;
      downloadHeadline.textContent = downloadInProgress
        ? 'Downloading selected layers...'
        : 'Download queue ready.';
    }
  
    async function downloadLayerItem(item) {
      item.status = 'downloading';
      item.error = null;
      renderQueueList();
      downloadDetail.textContent = `Fetching ${item.fullName}...`;
      const { info, url } = await fetchLayerMetadata(item.serviceUrl, item.id);
      item.info = info;
      item.sourceUrl = url;
      const { features, spatialRef } = await fetchAllFeatures(url, info, ({ fetched, total }) => {
        downloadDetail.textContent = `Fetched ${fetched} of ${total} records for ${info.name}...`;
      });

      const hasGeometry = features.some(feature => feature?.geometry?.length);
      item.fileExtension = hasGeometry ? 'geoparquet' : 'parquet';
      
      const deps = {
        Arrow: window.Arrow,
        WriterPropertiesBuilder,
        Compression,
        writeParquet,
        WasmTable
      };

      const blob = await createGeoParquetBlob(deps, features, spatialRef, info.geometryType, info.fields);
      item.blob = blob;
      item.status = 'ready';
      log(`Layer ${info.name} ready for export.`);
      renderQueueList();
    }
  
    function renderQueueList() {
      queueList.innerHTML = '';
      queuedLayers.forEach((item, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = `queue-item${item.enabled ? '' : ' queue-disabled'}`;
  
        const header = document.createElement('header');
        const title = document.createElement('h4');
        title.textContent = item.fullName;
        const badge = document.createElement('span');
        badge.className = 'queue-badge';
        if (item.status === 'ready') badge.classList.add('done');
        if (item.status === 'error') badge.classList.add('error');
        badge.textContent = item.status === 'ready'
          ? 'Ready'
          : item.status === 'downloading'
            ? 'Downloading'
            : item.status === 'error'
              ? 'Error'
              : 'Pending';
        header.appendChild(title);
        header.appendChild(badge);
        wrapper.appendChild(header);
  
        const meta = document.createElement('div');
        meta.className = 'queue-meta';
        const slug = document.createElement('span');
        slug.className = 'queue-status';
        slug.textContent = `Slug: ${item.slug}`;
        meta.appendChild(slug);
        if (item.error) {
          const error = document.createElement('span');
          error.className = 'queue-status';
          error.textContent = item.error;
          meta.appendChild(error);
        }
        wrapper.appendChild(meta);
  
        const actions = document.createElement('div');
        actions.className = 'queue-actions';
  
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = item.enabled ? 'Disable' : 'Enable';
        toggleBtn.addEventListener('click', () => {
          item.enabled = !item.enabled;
          updateQueueControls();
          updateOverallProgress();
          renderQueueList();
        });
        actions.appendChild(toggleBtn);
  
        const previewBtn = document.createElement('button');
        previewBtn.textContent = 'Preview metadata';
        previewBtn.addEventListener('click', async () => {
          metadataPanel.classList.remove('hidden');
          metadataContent.innerHTML = '<div class="muted">Loading metadata...</div>';
          try {
            const preview = await fetchLayerPreview(item.serviceUrl, item.id);
            metadataContent.innerHTML = buildPreviewMarkup(preview);
          } catch (err) {
            metadataContent.innerHTML = `<div class="muted">${formatFetchError(err, 'Failed to load metadata')}</div>`;
          }
        });
        actions.appendChild(previewBtn);
  
        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = item.blob ? 'Save file' : 'Save file';
        downloadBtn.disabled = !item.blob;
        downloadBtn.addEventListener('click', () => {
          if (!item.blob) return;
          triggerDownload(item.blob, `${item.slug}.${item.fileExtension ?? 'geoparquet'}`);
        });
        actions.appendChild(downloadBtn);
  
        wrapper.appendChild(actions);
        queueList.appendChild(wrapper);
      });
      updateQueueControls();
    }
  
    function attachLayerHandler() {
      layerSelectBtn.addEventListener('click', async () => {
        if (!selectedLayers.length) return;
        layerStatus.textContent = 'Preparing download queue...';
        resetStep3State();
        buildQueueFromSelection();
        renderQueueList();
        updateOverallProgress();
        downloadHeadline.textContent = `Selected ${queuedLayers.length} layer${queuedLayers.length === 1 ? '' : 's'} for download.`;
        metadataPanel.classList.add('hidden');
        metadataContent.innerHTML = '';
        updateMaxVisited(3);
        layerStatus.textContent = '';
      });
    }
  
    function attachPreviewHandler() {
      previewLayerBtn.addEventListener('click', async () => {
        if (!selectedLayers.length) return;
        previewLayerBtn.disabled = true;
        previewPanel.classList.remove('hidden');
        previewContent.innerHTML = '';
        try {
          const previews = await Promise.all(selectedLayers.map(async (layer) => {
            const baseUrl = layer.serviceUrl || normalizeUrl(endpointInput.value.trim());
            const preview = await fetchLayerPreview(baseUrl, layer.id);
            return { layer, preview };
          }));
          previews.forEach(({ layer, preview }) => {
            const details = document.createElement('details');
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = layer.name;
            details.appendChild(summary);
            const content = document.createElement('div');
            content.innerHTML = buildPreviewMarkup(preview);
            details.appendChild(content);
            previewContent.appendChild(details);
          });
        } catch (err) {
          console.error(err);
          previewContent.innerHTML = `<div class="muted">${formatFetchError(err, 'Failed to load preview')}</div>`;
        } finally {
          previewLayerBtn.disabled = false;
        }
      });
    }
  
    function attachQueueHandlers() {
      startDownloadBtn.addEventListener('click', async () => {
        if (downloadInProgress) return;
        const enabledItems = queuedLayers.filter(item => item.enabled);
        if (!enabledItems.length) return;
        downloadInProgress = true;
        exportStatus.textContent = 'Downloading selected layers...';
        updateQueueControls();
        try {
          for (const item of enabledItems) {
            if (!item.enabled) continue;
            try {
              await downloadLayerItem(item);
            } catch (err) {
              item.status = 'error';
              item.error = formatFetchError(err);
              console.error("Export error:", err)
              log(`Failed to download ${item.fullName}: ${buildFetchErrorMessage(err)}`);
              renderQueueList();
            }
            updateOverallProgress();
          }
        } finally {
          downloadInProgress = false;
          updateQueueControls();
          updateOverallProgress();
          const enabledCount = queuedLayers.filter(item => item.enabled).length;
          const readyCount = queuedLayers.filter(item => item.enabled && item.status === 'ready').length;
          if (enabledCount && readyCount === enabledCount) {
            exportStatus.textContent = 'All selected layers downloaded.';
          }
        }
      });
  
      downloadAllBtn.addEventListener('click', async () => {
        const readyItems = queuedLayers.filter(item => item.enabled && item.status === 'ready' && item.blob);
        if (!readyItems.length) return;
        const files = [];
        const manifestEntries = [];
        for (const item of readyItems) {
          const data = new Uint8Array(await item.blob.arrayBuffer());
          const extension = item.fileExtension ?? 'geoparquet';
          const filename = `${item.slug}.${extension}`;
          files.push({ name: filename, data });
          manifestEntries.push({
            filename,
            url: item.sourceUrl || item.layerUrl || item.serviceUrl || ''
          });
        }
        const manifestData = new TextEncoder().encode(JSON.stringify({ files: manifestEntries }, null, 2));
        files.push({ name: 'download_manifest.json', data: manifestData });
        const zipBlob = buildZipBlob(files);
        triggerDownload(zipBlob, 'layers.zip');
      });
    }

    function attachBreadcrumbHandlers() {
      breadcrumbButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const step = Number.parseInt(btn.dataset.step, 10);
          if (!Number.isFinite(step) || step > maxVisitedStep) return;
          setStep(step);
        });
      });
    }

    function attachMetadataCloseHandler() {
      metadataCloseBtn.addEventListener('click', () => {
        metadataPanel.classList.add('hidden');
        metadataContent.innerHTML = '';
      });
    }
  
    function init() {
      attachEndpointHandler();
      attachLayerHandler();
      attachPreviewHandler();
      attachQueueHandlers();
      attachBreadcrumbHandlers();
      attachMetadataCloseHandler();
      setStep(1);
    }

    init();
}

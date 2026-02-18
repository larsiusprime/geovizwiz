import { triggerDownload } from '../export/download.js';

const fmtTime = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
};

export default function startConstructApp() {
  const page = (n) => document.getElementById(`page${n}`);
  const breadcrumbButtons = Array.from(document.querySelectorAll('.breadcrumb'));
  const leftInput = document.getElementById('leftInput');
  const rightInput = document.getElementById('rightInput');
  const leftBrowse = document.getElementById('leftBrowse');
  const rightBrowse = document.getElementById('rightBrowse');
  const leftDrop = document.getElementById('leftDrop');
  const rightDrop = document.getElementById('rightDrop');
  const leftStatus = document.getElementById('leftStatus');
  const rightStatus = document.getElementById('rightStatus');
  const swapNotice = document.getElementById('swapNotice');
  const toStep2 = document.getElementById('toStep2');
  const toStep3 = document.getElementById('toStep3');
  const runConstruct = document.getElementById('runConstruct');
  const leftKey = document.getElementById('leftKey');
  const rightKey = document.getElementById('rightKey');
  const leftDedup = document.getElementById('leftDedup');
  const rightDedup = document.getElementById('rightDedup');
  const leftSort = document.getElementById('leftSort');
  const rightSort = document.getElementById('rightSort');
  const previewStats = document.getElementById('previewStats');
  const previewCols = document.getElementById('previewCols');
  const logEl = document.getElementById('log');
  const outFmt = document.getElementById('outFmt');
  const outName = document.getElementById('outName');
  const constructStatus = document.getElementById('constructStatus');

  const state = { step: 1, max: 1, leftFile: null, rightFile: null, leftInfo: null, rightInfo: null, preview: null };

  const setStep = (n) => {
    state.step = n;
    for (let i = 1; i <= 4; i += 1) page(i).classList.toggle('hidden', i !== n);
    breadcrumbButtons.forEach((b) => {
      const s = Number(b.dataset.step);
      b.classList.toggle('current', s === n);
      if (s > state.max) b.setAttribute('disabled', 'disabled'); else b.removeAttribute('disabled');
    });
  };

  const log = (msg) => {
    logEl.textContent += `${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  const workerCall = (payload) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./constructWorker.js', import.meta.url));
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Operation timed out while loading data. Please verify the file and try again.'));
    }, 120000);
    worker.onmessage = (e) => {
      const { type, payload: p } = e.data || {};
      if (type === 'log') log(p.message);
      if (type === 'error') { clearTimeout(timeout); worker.terminate(); reject(new Error(p.message)); }
      if (type === 'success') { clearTimeout(timeout); worker.terminate(); resolve(p); }
    };
    worker.onerror = (e) => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message || 'Worker failure')); };
    worker.postMessage(payload);
  });

  const fillFields = () => {
    const leftFields = state.leftInfo?.fields || [];
    const rightFields = state.rightInfo?.fields || [];
    const fill = (sel, arr) => {
      sel.innerHTML = '';
      arr.forEach((f) => {
        const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o);
      });
    };
    [leftKey, leftDedup, leftSort].forEach((s) => fill(s, leftFields));
    [rightKey, rightDedup, rightSort].forEach((s) => fill(s, rightFields));
  };

  const checkStep1 = () => {
    const leftGeom = Boolean(state.leftInfo?.hasGeometry);
    toStep2.disabled = !(state.leftInfo && state.rightInfo && leftGeom);
    let html = '';
    if (state.rightInfo?.hasGeometry) {
      html += '<p><strong>RIGHT contains geometry.</strong> RIGHT geometry will be ignored.</p>';
      html += '<button type="button" id="swapBtn" class="button-secondary">Swap LEFT and RIGHT</button>';
    }
    if (state.leftInfo?.hasGeometry && state.rightInfo?.hasGeometry) {
      html += '<p class="muted">Only LEFT geometry will be retained in output.</p>';
    }
    swapNotice.innerHTML = html;
    swapNotice.classList.toggle('hidden', !html);
    const swapBtn = document.getElementById('swapBtn');
    if (swapBtn) swapBtn.onclick = () => {
      [state.leftFile, state.rightFile] = [state.rightFile, state.leftFile];
      [state.leftInfo, state.rightInfo] = [state.rightInfo, state.leftInfo];
      leftStatus.textContent = `Loaded: ${state.leftInfo.label}`;
      rightStatus.textContent = `Loaded: ${state.rightInfo.label}`;
      checkStep1();
    };
  };

  const loadSide = async (side, file) => {
    if (!file) return;
    const statusEl = side === 'left' ? leftStatus : rightStatus;
    statusEl.textContent = 'Loading...';
    try {
      const info = await workerCall({ mode: 'inspect', file, side });
      if (side === 'left') { state.leftFile = file; state.leftInfo = info; }
      else { state.rightFile = file; state.rightInfo = info; }
      statusEl.textContent = `Loaded: ${info.label} (${info.rowCount} rows, ${info.hasGeometry ? 'with' : 'no'} geometry)`;
      checkStep1();
    } catch (err) {
      statusEl.textContent = err.message;
    }
  };

  const setupDrop = (drop, input, side) => {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('drag');
      const [file] = e.dataTransfer.files || [];
      loadSide(side, file);
    });
    input.addEventListener('change', () => loadSide(side, input.files?.[0]));
  };

  leftBrowse.onclick = () => leftInput.click();
  rightBrowse.onclick = () => rightInput.click();
  setupDrop(leftDrop, leftInput, 'left');
  setupDrop(rightDrop, rightInput, 'right');

  toStep2.onclick = () => {
    fillFields();
    state.max = Math.max(state.max, 2);
    setStep(2);
  };

  document.getElementById('backTo1').onclick = () => setStep(1);
  document.getElementById('backTo2').onclick = () => setStep(2);
  document.getElementById('backTo3').onclick = () => setStep(3);

  toStep3.onclick = async () => {
    try {
      const options = collectOptions();
      const preview = await workerCall({ mode: 'preview', leftFile: state.leftFile, rightFile: state.rightFile, options });
      state.preview = preview;
      previewStats.innerHTML = `<table><tbody>
      <tr><th>Matched rows</th><td>${preview.matched}</td></tr>
      <tr><th>Unmatched LEFT</th><td>${preview.unmatchedLeft}</td></tr>
      <tr><th>Unmatched RIGHT</th><td>${preview.unmatchedRight}</td></tr>
      <tr><th>Null/empty LEFT keys</th><td>${preview.emptyLeft}</td></tr>
      <tr><th>Null/empty RIGHT keys</th><td>${preview.emptyRight}</td></tr>
      <tr><th>LEFT duplicates dropped</th><td>${preview.leftDropped}</td></tr>
      <tr><th>RIGHT duplicates dropped</th><td>${preview.rightDropped}</td></tr>
      </tbody></table>`;
      previewCols.textContent = (preview.sampleColumns || []).join(', ');
      state.max = Math.max(state.max, 3);
      setStep(3);
    } catch (err) {
      previewStats.textContent = err.message;
    }
  };

  const collectOptions = () => ({
    joinType: document.getElementById('joinType').value,
    leftKey: leftKey.value,
    rightKey: rightKey.value,
    leftDedup: leftDedup.value,
    rightDedup: rightDedup.value,
    leftSort: leftSort.value,
    rightSort: rightSort.value,
    leftSortDir: document.getElementById('leftSortDir').value,
    rightSortDir: document.getElementById('rightSortDir').value,
    outputKeys: document.getElementById('outputKeys').value,
    normalize: {
      trim: document.getElementById('optTrim').checked,
      caseInsensitive: document.getElementById('optCase').checked,
      slugify: document.getElementById('optSlug').checked,
      stripLeadingZeroes: document.getElementById('optZeroL').checked,
      stripTrailingZeroes: document.getElementById('optZeroR').checked,
      removeChars: document.getElementById('optRemove').value,
      replaceFrom: document.getElementById('optReplaceFrom').value,
      replaceTo: document.getElementById('optReplaceTo').value
    }
  });

  runConstruct.onclick = () => {
    state.max = Math.max(state.max, 4);
    const ext = outFmt.value === 'geopackage' ? 'gpkg' : outFmt.value === 'shpzip' ? 'shp.zip' : 'geoparquet';
    outName.value = `constructed_${fmtTime()}.${ext}`;
    setStep(4);
  };

  outFmt.onchange = () => runConstruct.click();

  document.getElementById('saveBtn').onclick = async () => {
    constructStatus.textContent = 'Constructing...';
    try {
      const options = collectOptions();
      const result = await workerCall({ mode: 'construct', leftFile: state.leftFile, rightFile: state.rightFile, options, outputFormat: outFmt.value });
      const name = outName.value?.trim() || `constructed_${fmtTime()}.${result.extension}`;
      triggerDownload(new Blob([result.bytes], { type: result.mimeType }), name);
      constructStatus.textContent = `Saved ${name}`;
    } catch (err) {
      constructStatus.textContent = err.message;
    }
  };

  breadcrumbButtons.forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.step);
    if (n <= state.max) setStep(n);
  }));

  setStep(1);
}

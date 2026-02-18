import { triggerDownload } from '../export/download.js';

const TYPE_OPTIONS = ['source', 'string', 'integer', 'float', 'boolean', 'date', 'datetime'];
const resolvedType = (col) => (col.targetType === 'source' ? col.inferredType : col.targetType);
const fmtTime = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

export default function startConstructApp() {
  const byId = (id) => document.getElementById(id);
  const pages = [1,2,3,4,5].map((n)=>byId(`page${n}`));
  const breadcrumbButtons = Array.from(document.querySelectorAll('.breadcrumb'));
  const state = { step:1, max:1, leftFile:null,rightFile:null,leftInfo:null,rightInfo:null,leftCsvOptions:null,rightCsvOptions:null,review:{left:[],right:[]}, preview:null };

  const logEl = byId('log');
  const log = (msg) => { logEl.textContent += `${msg}\n`; logEl.scrollTop = logEl.scrollHeight; };

  const workerCall = (payload) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./constructWorker.js', import.meta.url));
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Operation timed out while loading data. Please verify the file and try again.')); }, 180000);
    worker.onmessage = (e) => { const { type, payload:p } = e.data || {}; if (type === 'log') log(p.message); if (type === 'error') { clearTimeout(timeout); worker.terminate(); reject(new Error(p.message)); } if (type === 'success') { clearTimeout(timeout); worker.terminate(); resolve(p); } };
    worker.onerror = (e) => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message || 'Worker failure')); };
    worker.postMessage(payload);
  });

  const setStep = (n) => {
    state.step = n; pages.forEach((p,i)=>p.classList.toggle('hidden', i !== n-1));
    breadcrumbButtons.forEach((b)=>{ const s = Number(b.dataset.step); b.classList.toggle('current', s===n); if (s>state.max) b.setAttribute('disabled','disabled'); else b.removeAttribute('disabled');});
  };

  const renderCsvPreview = (side, info) => {
    const panel = byId(`${side}CsvPanel`), preview = byId(`${side}CsvPreview`), d = byId(`${side}CsvDelimiter`), h = byId(`${side}CsvHeader`);
    if (!info?.csv) { panel.classList.add('hidden'); preview.innerHTML = ''; return; }
    panel.classList.remove('hidden'); d.value = info.csv.delimiter || ','; h.checked = info.csv.hasHeader !== false;
    const allCols = info.csv.header || [];
    const cols = allCols.slice(0, 20);
    const rows = info.csv.previewRows || [];
    const colNotice = allCols.length > cols.length
      ? ` Showing first ${cols.length} of ${allCols.length} columns.`
      : '';
    preview.innerHTML = `<p class="muted">Previewing ${rows.length} rows. Parsed total rows: ${info.rowCount}.${colNotice}</p><div style="overflow:auto"><table style="table-layout:auto"><thead><tr>${cols.map((c)=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r)=>`<tr>${cols.map((c)=>`<td>${r[c] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };

  const checkStep1 = () => {
    const leftGeom = Boolean(state.leftInfo?.hasGeometry);
    byId('toStep2').disabled = !(state.leftInfo && state.rightInfo && leftGeom);
    let html = '';
    if (state.rightInfo?.hasGeometry) html += '<p><strong>RIGHT contains geometry.</strong> RIGHT geometry will be ignored.</p><button type="button" id="swapBtn" class="button-secondary">Swap LEFT and RIGHT</button>';
    if (state.leftInfo?.hasGeometry && state.rightInfo?.hasGeometry) html += '<p class="muted">Only LEFT geometry will be retained in output.</p>';
    byId('swapNotice').innerHTML = html; byId('swapNotice').classList.toggle('hidden', !html);
    const swapBtn = byId('swapBtn');
    if (swapBtn) swapBtn.onclick = () => {
      [state.leftFile, state.rightFile] = [state.rightFile, state.leftFile]; [state.leftInfo, state.rightInfo] = [state.rightInfo, state.leftInfo]; [state.leftCsvOptions, state.rightCsvOptions] = [state.rightCsvOptions, state.leftCsvOptions];
      byId('leftStatus').textContent = `Loaded: ${state.leftInfo.label}`; byId('rightStatus').textContent = `Loaded: ${state.rightInfo.label}`;
      renderCsvPreview('left', state.leftInfo); renderCsvPreview('right', state.rightInfo); checkStep1();
    };
  };

  const loadSide = async (side, file) => {
    if (!file) return; const statusEl = byId(`${side}Status`); statusEl.textContent = 'Loading...';
    try {
      const csvOptions = side === 'left' ? state.leftCsvOptions : state.rightCsvOptions;
      const info = await workerCall({ mode:'inspect', file, side, csvOptions });
      if (side === 'left') { state.leftFile = file; state.leftInfo = info; state.leftCsvOptions = info.csv ? { delimiter: info.csv.delimiter, hasHeader: info.csv.hasHeader } : null; }
      else { state.rightFile = file; state.rightInfo = info; state.rightCsvOptions = info.csv ? { delimiter: info.csv.delimiter, hasHeader: info.csv.hasHeader } : null; }
      statusEl.textContent = `Loaded: ${info.label} (${info.rowCount} rows, ${info.hasGeometry ? 'with' : 'no'} geometry)`;
      renderCsvPreview(side, info); checkStep1();
    } catch (err) { statusEl.textContent = err.message; }
  };

  const setupDrop = (side) => {
    const drop = byId(`${side}Drop`), input = byId(`${side}Input`);
    drop.addEventListener('dragover', (e)=>{ e.preventDefault(); drop.classList.add('drag');});
    drop.addEventListener('dragleave', ()=>drop.classList.remove('drag'));
    drop.addEventListener('drop', (e)=>{ e.preventDefault(); drop.classList.remove('drag'); loadSide(side, (e.dataTransfer.files || [])[0]);});
    input.addEventListener('change', ()=>loadSide(side, input.files?.[0]));
    byId(`${side}Browse`).onclick = () => input.click();
  };

  const columnRow = (side, col, idx, showDateFormat) => {
    const target = col.targetType || 'source';
    const options = TYPE_OPTIONS.map((t)=>{
      const label = t === 'source' ? `source (${col.inferredType})` : t;
      return `<option value="${t}" ${t===target?'selected':''}>${label}</option>`;
    }).join('');
    const mixed = col.mixed ? '<span class="warn">mixed values</span>' : '';
    const showFormatInput = showDateFormat && ['date', 'datetime'].includes(resolvedType(col));
    return `<tr>
      <td><input type="checkbox" data-side="${side}" data-idx="${idx}" data-k="selected" ${col.selected?'checked':''}></td>
      <td class="source-cell">${col.sourceName}</td>
      <td><input type="text" data-side="${side}" data-idx="${idx}" data-k="outputName" value="${col.outputName}"></td>
      <td><select data-side="${side}" data-idx="${idx}" data-k="targetType">${options}</select> ${mixed}</td>
      <td><select data-side="${side}" data-idx="${idx}" data-k="policy"><option value="string" ${col.policy==='string'?'selected':''}>string</option><option value="coerce" ${col.policy==='coerce'?'selected':''}>coerce</option></select></td>
      <td><input type="text" data-side="${side}" data-idx="${idx}" data-k="fallback" value="${col.fallback ?? ''}" placeholder="null"></td>
      ${showDateFormat ? `<td>${showFormatInput ? `<input type="text" data-side="${side}" data-idx="${idx}" data-k="format" value="${col.format ?? ''}" placeholder="auto">` : ''}</td>` : ''}
      <td>${col.nonNullCount}</td>
    </tr>`;
  };

  const renderReviewTables = () => {
    const render = (side) => {
      const cols = state.review[side];
      const showDateFormat = cols.some((c) => ['date', 'datetime'].includes(resolvedType(c)));
      const rows = cols.map((c, i) => columnRow(side, c, i, showDateFormat)).join('');
      const total = side === 'left' ? (state.leftInfo?.rowCount ?? 0) : (state.rightInfo?.rowCount ?? 0);
      const allSelected = cols.length > 0 && cols.every((c) => c.selected);
      byId(`${side}Columns`).innerHTML = `<div class="muted" style="margin:.25rem .25rem .5rem">Total rows: ${total}</div><table><thead><tr><th><label style="display:flex;align-items:center;gap:.35rem;"><input type="checkbox" data-side-toggle="${side}" ${allSelected ? 'checked' : ''}> <span>Use</span></label></th><th class="source-cell">Field</th><th>Output name</th><th>Type</th><th>Mixed policy</th><th>Default</th>${showDateFormat ? '<th>Date format</th>' : ''}<th>Non-empty</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    render('left'); render('right');
    document.querySelectorAll('[data-side-toggle]').forEach((el) => {
      el.onchange = () => {
        const side = el.dataset.sideToggle;
        state.review[side].forEach((col) => { col.selected = el.checked; });
        renderReviewTables();
        fillKeySelectors();
        validateReview();
      };
    });
    document.querySelectorAll('[data-side][data-idx][data-k]').forEach((el)=>{
      el.onchange = () => {
        const side = el.dataset.side; const idx = Number(el.dataset.idx); const k = el.dataset.k;
        const value = el.type === 'checkbox' ? el.checked : el.value;
        state.review[side][idx][k] = value;
        fillKeySelectors();
        validateReview();
      };
    });
  };

  const setupReviewTabs = () => {
    const tabs = Array.from(document.querySelectorAll('#reviewTabs .review-tab'));
    tabs.forEach((tab) => {
      tab.onclick = () => {
        const side = tab.dataset.side;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        byId('leftColumns').classList.toggle('hidden', side !== 'left');
        byId('rightColumns').classList.toggle('hidden', side !== 'right');
      };
    });
  };

  const validateReview = () => {
    const messages = [];
    const invalidName = [...state.review.left, ...state.review.right].filter((c)=>c.selected && !c.outputName.trim());
    if (invalidName.length) messages.push('All selected columns must have an output name.');
    const selectedAll = [...state.review.left.filter((c)=>c.selected), ...state.review.right.filter((c)=>c.selected)];
    const unresolvedMixed = selectedAll.filter((c)=>c.mixed && !c.policy);
    if (unresolvedMixed.length) messages.push('Mixed-type columns require a policy.');
    const dateMissing = selectedAll.filter((c)=>['date','datetime'].includes(resolvedType(c)) && !c.format);
    if (dateMissing.length) messages.push('Date/datetime columns require a format token or "auto".');
    const mismatchedKey = byId('leftKey')?.value && byId('rightKey')?.value && (state.review.left.find((c)=>c.sourceName===byId('leftKey').value)?.targetType !== state.review.right.find((c)=>c.sourceName===byId('rightKey').value)?.targetType);
    if (mismatchedKey) messages.push('Join key types differ between LEFT and RIGHT.');
    // Collision validation intentionally deferred until Step 3 after join keys are selected.
    byId('reviewStatus').innerHTML = messages.length ? `<span class="error">${messages.join(' ')}</span>` : '<span class="muted">Review checks passed.</span>';
    byId('toStep3').disabled = messages.length > 0;
  };

  const validateConfigureCollisions = () => {
    const leftKey = byId('leftKey').value;
    const rightKey = byId('rightKey').value;
    const leftNames = state.review.left.filter((c) => c.selected).map((c) => c.outputName.trim()).filter(Boolean);
    const rightNames = state.review.right.filter((c) => c.selected).map((c) => c.outputName.trim()).filter(Boolean);
    const intersection = rightNames.filter((n) => leftNames.includes(n));
    const exempt = leftKey && rightKey && leftKey === rightKey ? new Set([leftKey]) : new Set();
    const collisions = intersection.filter((n) => !exempt.has(n));
    if (!collisions.length) {
      byId('configureStatus').innerHTML = '<span class="muted">Column collision checks passed.</span>';
      return { ok: true, collisions: [] };
    }
    byId('configureStatus').innerHTML = `<span class="error">Column name collisions after key selection: ${collisions.join(', ')}. Go back to Review and rename/exclude or use auto-suffix.</span> <button type="button" id="autoSuffixFromConfigure" class="button-secondary">Auto suffix RIGHT collisions (_right)</button>`;
    const btn = byId('autoSuffixFromConfigure');
    if (btn) {
      btn.onclick = () => {
        state.review.right.forEach((c) => { if (c.selected && collisions.includes(c.outputName.trim())) c.outputName = `${c.outputName}_right`; });
        renderReviewTables();
        fillKeySelectors();
        validateConfigureCollisions();
      };
    }
    return { ok: false, collisions };
  };

  const buildInitialReview = () => {
    const init = (info) => (info.columnProfiles || []).map((p)=>({ selected:true, sourceName:p.name, outputName:p.name, inferredType:p.inferredType || 'string', sourceType:p.inferredType || 'string', targetType:'source', policy:'string', fallback:'', format:'auto', mixed:p.mixed, nonNullCount:p.nonNullCount, totalCount:p.totalCount }));
    state.review.left = init(state.leftInfo); state.review.right = init(state.rightInfo);
    renderReviewTables(); validateReview();
  };

  const fillKeySelectors = () => {
    const fill = (id, arr) => {
      const el = byId(id); el.innerHTML = '';
      arr.filter((f) => f.selected).forEach((f) => {
        const o = document.createElement('option');
        o.value = f.outputName;
        o.textContent = `${f.outputName} ← ${f.sourceName}`;
        el.appendChild(o);
      });
    };
    fill('leftKey', state.review.left); fill('leftDedup', state.review.left); fill('leftSort', state.review.left);
    fill('rightKey', state.review.right); fill('rightDedup', state.review.right); fill('rightSort', state.review.right);
  };

  const collectOptions = () => ({
    joinType: byId('joinType').value, leftKey: byId('leftKey').value, rightKey: byId('rightKey').value, leftDedup: byId('leftDedup').value, rightDedup: byId('rightDedup').value, leftSort: byId('leftSort').value, rightSort: byId('rightSort').value, leftSortDir: byId('leftSortDir').value, rightSortDir: byId('rightSortDir').value, outputKeys: byId('outputKeys').value,
    normalize: { trim: byId('optTrim').checked, caseInsensitive: byId('optCase').checked, slugify: byId('optSlug').checked, stripLeadingZeroes: byId('optZeroL').checked, stripTrailingZeroes: byId('optZeroR').checked, removeChars: byId('optRemove').value, replaceFrom: byId('optReplaceFrom').value, replaceTo: byId('optReplaceTo').value },
    review: state.review
  });

  byId('toStep2').onclick = () => { state.max = Math.max(state.max,2); buildInitialReview(); fillKeySelectors(); setStep(2); };
  byId('toStep3').onclick = () => { state.max = Math.max(state.max,3); fillKeySelectors(); validateConfigureCollisions(); setStep(3); };
  byId('toStep4').onclick = async () => {
    const cc = validateConfigureCollisions();
    if (!cc.ok) return;
    try { const preview = await workerCall({ mode:'preview', leftFile:state.leftFile, rightFile:state.rightFile, options:collectOptions(), csvOptions:{left:state.leftCsvOptions,right:state.rightCsvOptions} });
      state.preview = preview; byId('previewStats').innerHTML = `<table><tbody><tr><th>Matched rows</th><td>${preview.matched}</td></tr><tr><th>Unmatched LEFT</th><td>${preview.unmatchedLeft}</td></tr><tr><th>Unmatched RIGHT</th><td>${preview.unmatchedRight}</td></tr><tr><th>Null/empty LEFT keys</th><td>${preview.emptyLeft}</td></tr><tr><th>Null/empty RIGHT keys</th><td>${preview.emptyRight}</td></tr><tr><th>LEFT duplicates dropped</th><td>${preview.leftDropped}</td></tr><tr><th>RIGHT duplicates dropped</th><td>${preview.rightDropped}</td></tr></tbody></table>`; byId('previewCols').textContent = (preview.sampleColumns||[]).join(', '); state.max = Math.max(state.max,4); setStep(4);
    } catch (err) { byId('previewStats').innerHTML = `<span class="error">${err.message}</span>`; }
  };

  byId('runConstruct').onclick = () => { state.max = Math.max(state.max,5); const ext = byId('outFmt').value === 'geopackage' ? 'gpkg' : byId('outFmt').value === 'shpzip' ? 'shp.zip' : 'geoparquet'; byId('outName').value = `constructed_${fmtTime()}.${ext}`; setStep(5); };
  byId('outFmt').onchange = () => byId('runConstruct').click();

  byId('saveBtn').onclick = async () => {
    byId('constructStatus').textContent = 'Constructing...';
    try { const result = await workerCall({ mode:'construct', leftFile:state.leftFile, rightFile:state.rightFile, options:collectOptions(), outputFormat:byId('outFmt').value, csvOptions:{left:state.leftCsvOptions,right:state.rightCsvOptions} });
      const name = byId('outName').value?.trim() || `constructed_${fmtTime()}.${result.extension}`; triggerDownload(new Blob([result.bytes], { type: result.mimeType }), name); byId('constructStatus').textContent = `Saved ${name}`;
    } catch (err) { byId('constructStatus').textContent = err.message; }
  };

  ['left','right'].forEach(setupDrop);
  setupReviewTabs();
  byId('leftCsvApply').onclick = () => { state.leftCsvOptions = { delimiter: byId('leftCsvDelimiter').value, hasHeader: byId('leftCsvHeader').checked }; loadSide('left', state.leftFile); state.review.left = []; };
  byId('rightCsvApply').onclick = () => { state.rightCsvOptions = { delimiter: byId('rightCsvDelimiter').value, hasHeader: byId('rightCsvHeader').checked }; loadSide('right', state.rightFile); state.review.right = []; };
  byId('backTo1').onclick = () => setStep(1); byId('backTo2').onclick = () => setStep(2); byId('backTo3').onclick = () => setStep(3); byId('backTo4').onclick = () => setStep(4);
  breadcrumbButtons.forEach((b)=>b.onclick = ()=>{ const s = Number(b.dataset.step); if (s <= state.max) setStep(s); });
  setStep(1);
}

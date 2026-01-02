export default function startConverterApp() {
  const page1 = document.getElementById('page1');
  const page2 = document.getElementById('page2');
  const page3 = document.getElementById('page3');
  const dropZone = document.getElementById('dropZone');
  const browseBtn = document.getElementById('browseBtn');
  const fileInput = document.getElementById('fileInput');
  const fileStatus = document.getElementById('fileStatus');
  const fileName = document.getElementById('fileName');
  const fileFormat = document.getElementById('fileFormat');
  const fileValidation = document.getElementById('fileValidation');
  const progressPanel = document.getElementById('progressPanel');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBar = document.getElementById('progressBar');
  const progressSpinner = document.getElementById('progressSpinner');
  const metadataPanel = document.getElementById('metadataPanel');
  const metadataContent = document.getElementById('metadataContent');
  const metadataToggle = document.getElementById('metadataToggle');
  const continueBtn = document.getElementById('continueBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const outputStatus = document.getElementById('outputStatus');
  const outputFormatInputs = Array.from(document.querySelectorAll('input[name="outputFormat"]'));
  const breadcrumbNav = document.getElementById('breadcrumbNav');
  const breadcrumbButtons = Array.from(breadcrumbNav.querySelectorAll('.breadcrumb'));

  let currentStep = 1;
  let maxVisitedStep = 1;
  let selectedOutputFormat = null;
  let activeWorker = null;

  const setCurrentStep = (step) => {
    currentStep = step;
    page1.classList.toggle('hidden', step !== 1);
    page2.classList.toggle('hidden', step !== 2);
    page3.classList.toggle('hidden', step !== 3);
    breadcrumbButtons.forEach((button) => {
      const buttonStep = Number(button.dataset.step);
      button.classList.toggle('current', buttonStep === step);
      if (buttonStep > maxVisitedStep) {
        button.setAttribute('disabled', 'disabled');
      } else {
        button.removeAttribute('disabled');
      }
    });
  };

  const resetMetadataPanel = () => {
    metadataPanel.classList.add('hidden');
    metadataPanel.classList.remove('metadata-collapsed');
    metadataContent.innerHTML = '';
    continueBtn.disabled = true;
    metadataToggle.setAttribute('aria-expanded', 'true');
    metadataToggle.textContent = '−';
  };

  const resetProgressPanel = () => {
    progressPanel.classList.add('hidden');
    progressText.textContent = 'Inspecting file contents...';
    progressPercent.textContent = '0%';
    progressBar.style.width = '0%';
    progressSpinner.classList.remove('paused');
  };

  const updateProgress = ({ percent = 0, detail = '' }) => {
    const clamped = Math.max(0, Math.min(100, percent));
    progressPanel.classList.remove('hidden');
    progressText.textContent = detail || 'Inspecting file contents...';
    progressPercent.textContent = `${clamped}%`;
    progressBar.style.width = `${clamped}%`;
    progressSpinner.classList.toggle('paused', clamped >= 100);
  };

  const renderMetadata = ({ layers, crs }) => {
    metadataContent.innerHTML = '';

    if (!layers.length) {
      metadataContent.textContent = 'No layers found in this shapefile.';
      metadataPanel.classList.remove('hidden');
      metadataPanel.classList.remove('metadata-collapsed');
      metadataToggle.setAttribute('aria-expanded', 'true');
      metadataToggle.textContent = '−';
      return;
    }

    layers.forEach((layer, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'preview-summary';
      const layerName = layer.fileName || `Layer ${index + 1}`;
      const geometryType = layer.geometryType || 'Unknown';
      const fieldInfo = layer.fields || [];
      const rowCount = Number.isFinite(layer.rowCount) ? layer.rowCount : 0;

      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      const rows = [
        ['Layer name', layerName],
        ['Layer type', 'Shapefile layer'],
        ['Number of rows', rowCount.toLocaleString()],
        ['Geometry field', 'geometry'],
        ['Geometry type', geometryType],
        ['CRS', crs]
      ];

      rows.forEach(([label, value]) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = label;
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(th);
        tr.appendChild(td);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrapper.appendChild(table);

      const fieldsWrapper = document.createElement('div');
      fieldsWrapper.className = 'preview-fields';
      if (!fieldInfo.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No attribute fields detected.';
        fieldsWrapper.appendChild(empty);
      } else {
        const fieldsTable = document.createElement('table');
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Field name', 'Field type'].forEach((title) => {
          const th = document.createElement('th');
          th.scope = 'col';
          th.textContent = title;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        fieldsTable.appendChild(thead);
        const fieldsBody = document.createElement('tbody');
        fieldInfo.forEach(({ name, type }) => {
          const row = document.createElement('tr');
          const nameCell = document.createElement('td');
          nameCell.textContent = name;
          const typeCell = document.createElement('td');
          typeCell.textContent = type;
          row.appendChild(nameCell);
          row.appendChild(typeCell);
          fieldsBody.appendChild(row);
        });
        fieldsTable.appendChild(fieldsBody);
        fieldsWrapper.appendChild(fieldsTable);
      }

      metadataContent.appendChild(wrapper);
      metadataContent.appendChild(fieldsWrapper);
    });

    metadataPanel.classList.remove('hidden');
    metadataPanel.classList.remove('metadata-collapsed');
    metadataToggle.setAttribute('aria-expanded', 'true');
    metadataToggle.textContent = '−';
  };

  const stopActiveWorker = () => {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  const resetToInitialState = () => {
    stopActiveWorker();
    resetProgressPanel();
    resetMetadataPanel();
    fileValidation.textContent = '';
    fileStatus.textContent = '';
    fileName.textContent = '—';
    fileFormat.textContent = '—';
    fileInput.value = '';
    maxVisitedStep = 1;
    setCurrentStep(1);
  };

  const handleFile = async (file) => {
    if (!file) {
      return;
    }
    stopActiveWorker();
    fileValidation.textContent = '';
    fileStatus.textContent = `Selected: ${file.name}`;
    fileName.textContent = file.name;
    fileFormat.textContent = 'Inspecting contents...';
    fileValidation.textContent = '';
    resetMetadataPanel();
    resetProgressPanel();
    updateProgress({ percent: 5, detail: 'Preparing to inspect file contents...' });
    maxVisitedStep = 2;
    setCurrentStep(2);

    const worker = new Worker(new URL('./converterWorker.js', import.meta.url));
    activeWorker = worker;

    worker.onmessage = (event) => {
      if (worker !== activeWorker) {
        return;
      }
      const { type, payload } = event.data || {};
      if (type === 'progress') {
        updateProgress(payload);
        return;
      }
      if (type === 'invalid') {
        updateProgress({ percent: 100, detail: 'Inspection complete.' });
        fileFormat.textContent = payload.label;
        fileValidation.textContent = payload.message;
        stopActiveWorker();
        return;
      }
      if (type === 'error') {
        updateProgress({ percent: 100, detail: 'Inspection failed.' });
        fileFormat.textContent = 'Unknown';
        fileValidation.textContent = payload.message;
        stopActiveWorker();
        return;
      }
      if (type === 'success') {
        updateProgress({ percent: 100, detail: 'Inspection complete.' });
        fileFormat.textContent = payload.label;
        fileValidation.textContent = payload.message;
        renderMetadata({ layers: payload.layers, crs: payload.crs });
        maxVisitedStep = 3;
        continueBtn.disabled = false;
        stopActiveWorker();
        return;
      }
    };

    worker.onerror = () => {
      if (worker !== activeWorker) {
        return;
      }
      updateProgress({ percent: 100, detail: 'Inspection failed.' });
      fileFormat.textContent = 'Unknown';
      fileValidation.textContent = 'An unexpected error occurred while inspecting the file.';
    };

    worker.postMessage({ file });
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
  };

  const handleDragLeave = () => {
    dropZone.classList.remove('drag-over');
  };

  const handleDrop = (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    handleFile(file);
  };

  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });

  browseBtn.addEventListener('click', (event) => {
    event.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    handleFile(file);
  });

  continueBtn.addEventListener('click', () => {
    if (maxVisitedStep >= 3) {
      setCurrentStep(3);
    }
  });

  outputFormatInputs.forEach((input) => {
    input.addEventListener('change', () => {
      selectedOutputFormat = input.value;
      outputStatus.textContent = `Output format selected: ${selectedOutputFormat}. Conversion will be available soon.`;
    });
  });

  cancelBtn.addEventListener('click', () => {
    resetToInitialState();
  });

  metadataToggle.addEventListener('click', () => {
    const isCollapsed = metadataPanel.classList.toggle('metadata-collapsed');
    metadataToggle.setAttribute('aria-expanded', String(!isCollapsed));
    metadataToggle.textContent = isCollapsed ? '+' : '−';
  });

  breadcrumbButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const step = Number(button.dataset.step);
      if (step <= maxVisitedStep) {
        setCurrentStep(step);
      }
    });
  });

  setCurrentStep(currentStep);
}

import "../../vendor/fflate/index.min.js";
import "../../vendor/shpjs/shp.min.js";

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
  const metadataPanel = document.getElementById('metadataPanel');
  const metadataContent = document.getElementById('metadataContent');
  const continueBtn = document.getElementById('continueBtn');
  const outputStatus = document.getElementById('outputStatus');
  const outputFormatInputs = Array.from(document.querySelectorAll('input[name="outputFormat"]'));
  const breadcrumbNav = document.getElementById('breadcrumbNav');
  const breadcrumbButtons = Array.from(breadcrumbNav.querySelectorAll('.breadcrumb'));
  const textDecoder = new TextDecoder();

  let currentStep = 1;
  let maxVisitedStep = 1;
  let selectedOutputFormat = null;

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
    metadataContent.innerHTML = '';
    continueBtn.disabled = true;
  };

  const readZipEntries = (buffer) => {
    const signature = new Uint8Array(buffer.slice(0, 4));
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
    if (!isZip || !globalThis.fflate?.unzipSync) {
      return null;
    }
    try {
      return globalThis.fflate.unzipSync(new Uint8Array(buffer));
    } catch (err) {
      return null;
    }
  };

  const identifyFormatFromContents = (buffer) => {
    const entries = readZipEntries(buffer);
    if (!entries) {
      return {
        label: 'Unknown',
        valid: false,
        message: 'Not a supported format. Upload a zipped ESRI Shapefile (.zip containing .shp + .dbf + .shx).'
      };
    }

    const entryNames = Object.keys(entries).map((name) => name.toLowerCase());
    const hasShp = entryNames.some((name) => name.endsWith('.shp'));
    const hasDbf = entryNames.some((name) => name.endsWith('.dbf'));
    const hasShx = entryNames.some((name) => name.endsWith('.shx'));

    if (!hasShp || !hasDbf) {
      return {
        label: 'ZIP archive',
        valid: false,
        message: 'Not a supported format. This zip archive does not contain the required .shp and .dbf files for a valid ESRI Shapefile.'
      };
    }

    if (!hasShx) {
      return {
        label: 'Partial ESRI Shapefile (missing .shx)',
        valid: false,
        message: 'Not a supported format. The zip archive is missing the .shx index file required for a complete ESRI Shapefile.'
      };
    }

    return {
      label: 'ESRI Shapefile (zipped)',
      valid: true,
      message: 'Valid format. Metadata extracted below. You may proceed to the conversion step.',
      entries
    };
  };

  const getCrsLabel = (entries) => {
    if (!entries) {
      return 'Unknown';
    }
    const prjName = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.prj'));
    if (!prjName) {
      return 'Unknown';
    }
    const prjText = textDecoder.decode(entries[prjName]);
    const match = prjText.match(/^(?:PROJCS|GEOGCS|LOCAL_CS|COMPD_CS)\s*\["([^"]+)"/i);
    return match?.[1] || prjText.split(/\r?\n/)[0]?.trim() || 'Unknown';
  };

  const getGeometryType = (features) => {
    const types = new Set();
    features.forEach((feature) => {
      const type = feature?.geometry?.type;
      if (type) {
        types.add(type);
      }
    });
    if (!types.size) {
      return 'Unknown';
    }
    if (types.size === 1) {
      return Array.from(types)[0];
    }
    return `Mixed (${Array.from(types).join(', ')})`;
  };

  const getFieldInfo = (features) => {
    const fieldTypes = new Map();
    const inferType = (value) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (Array.isArray(value)) {
        return 'array';
      }
      if (value instanceof Date) {
        return 'date';
      }
      return typeof value;
    };

    features.forEach((feature) => {
      const properties = feature?.properties || {};
      Object.entries(properties).forEach(([key, value]) => {
        if (!fieldTypes.has(key)) {
          fieldTypes.set(key, 'unknown');
        }
        const currentType = fieldTypes.get(key);
        if (currentType === 'unknown') {
          const inferred = inferType(value);
          if (inferred) {
            fieldTypes.set(key, inferred);
          }
        }
      });
    });

    return Array.from(fieldTypes.entries()).map(([name, type]) => ({ name, type }));
  };

  const renderMetadata = ({ layers, crs }) => {
    metadataContent.innerHTML = '';

    if (!layers.length) {
      metadataContent.textContent = 'No layers found in this shapefile.';
      metadataPanel.classList.remove('hidden');
      return;
    }

    layers.forEach((layer, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'preview-summary';
      const layerName = layer.fileName || `Layer ${index + 1}`;
      const features = layer.features || [];
      const geometryType = getGeometryType(features);
      const fieldInfo = getFieldInfo(features);

      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      const rows = [
        ['Layer name', layerName],
        ['Layer type', 'Shapefile layer'],
        ['Number of rows', features.length.toLocaleString()],
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
  };

  const handleFile = async (file) => {
    if (!file) {
      return;
    }
    fileValidation.textContent = '';
    fileStatus.textContent = `Selected: ${file.name}`;
    fileName.textContent = file.name;
    fileFormat.textContent = 'Checking file contents...';
    fileValidation.textContent = 'Inspecting file contents...';
    resetMetadataPanel();
    maxVisitedStep = 2;
    setCurrentStep(2);

    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err) {
      fileFormat.textContent = 'Unknown';
      fileValidation.textContent = 'Unable to read the file contents. Please try again.';
      return;
    }

    const formatInfo = identifyFormatFromContents(buffer);
    fileFormat.textContent = formatInfo.label;
    fileValidation.textContent = formatInfo.message;

    if (!formatInfo.valid) {
      return;
    }

    try {
      const layerData = await globalThis.shp(buffer);
      const layers = Array.isArray(layerData) ? layerData : [layerData];
      const crs = getCrsLabel(formatInfo.entries);
      renderMetadata({ layers, crs });
      maxVisitedStep = 3;
      continueBtn.disabled = false;
      fileValidation.textContent = 'Metadata loaded. You may proceed to the conversion step.';
    } catch (err) {
      const errorMessage = err?.message ? ` ${err.message}` : '';
      fileValidation.textContent = `We found a valid zipped shapefile, but could not read its metadata.${errorMessage}`;
    }
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

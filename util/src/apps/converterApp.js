export default function startConverterApp() {
  const page1 = document.getElementById('page1');
  const page2 = document.getElementById('page2');
  const dropZone = document.getElementById('dropZone');
  const browseBtn = document.getElementById('browseBtn');
  const fileInput = document.getElementById('fileInput');
  const fileStatus = document.getElementById('fileStatus');
  const fileName = document.getElementById('fileName');
  const fileFormat = document.getElementById('fileFormat');
  const fileValidation = document.getElementById('fileValidation');
  const breadcrumbNav = document.getElementById('breadcrumbNav');
  const breadcrumbButtons = Array.from(breadcrumbNav.querySelectorAll('.breadcrumb'));

  let currentStep = 1;
  let maxVisitedStep = 1;

  const setCurrentStep = (step) => {
    currentStep = step;
    page1.classList.toggle('hidden', step !== 1);
    page2.classList.toggle('hidden', step !== 2);
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

  const identifyFormat = (file) => {
    const name = file?.name || '';
    const lowerName = name.toLowerCase();

    if (lowerName.endsWith('.shp.zip')) {
      return {
        label: 'ESRI Shapefile (.shp.zip)',
        valid: true,
        message: 'Valid format. You may proceed to the next step (convert).'
      };
    }

    if (lowerName.endsWith('.parquet') || lowerName.endsWith('.geoparquet')) {
      return {
        label: 'Geoparquet',
        valid: true,
        message: 'Valid format. You may proceed to the next step (convert).'
      };
    }

    if (lowerName.endsWith('.gpkg')) {
      return {
        label: 'Geopackage',
        valid: true,
        message: 'Valid format. You may proceed to the next step (convert).'
      };
    }

    if (lowerName.endsWith('.zip')) {
      return {
        label: 'Unknown',
        valid: false,
        message: 'Not a valid format. ESRI Shapefiles must be supplied as a .shp.zip archive. Go back and try uploading a different file.'
      };
    }

    return {
      label: 'Unknown',
      valid: false,
      message: 'Not a valid format. Supported extensions are .shp.zip, .parquet, .geoparquet, or .gpkg. Go back and try uploading a different file.'
    };
  };

  const handleFile = (file) => {
    if (!file) {
      return;
    }
    fileValidation.textContent = '';
    fileStatus.textContent = `Selected: ${file.name}`;
    fileName.textContent = file.name;
    const formatInfo = identifyFormat(file);
    fileFormat.textContent = formatInfo.label;
    fileValidation.textContent = formatInfo.message;
    maxVisitedStep = Math.max(maxVisitedStep, 2);
    setCurrentStep(2);
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

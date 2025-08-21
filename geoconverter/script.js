class GPKGMetadataReader {
    constructor() {
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.results = document.getElementById('results');
        this.error = document.getElementById('error');
        this.fileSummary = document.getElementById('fileSummary');
        this.fieldsGrid = document.getElementById('fieldsGrid');
        this.errorMessage = document.getElementById('errorMessage');
        this.selectAllBtn = document.getElementById('selectAllBtn');
        this.selectNoneBtn = document.getElementById('selectNoneBtn');
        this.convertBtn = document.getElementById('convertBtn');
        
        this.selectedFields = new Set();
        this.userFields = [];
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Drag and drop events
        this.dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
        this.dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
        this.dropZone.addEventListener('drop', this.handleDrop.bind(this));
        
        // Click to browse
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
        
        // Selection controls
        this.selectAllBtn.addEventListener('click', this.selectAllFields.bind(this));
        this.selectNoneBtn.addEventListener('click', this.selectNoneFields.bind(this));
        
        // Convert button (placeholder for now)
        this.convertBtn.addEventListener('click', this.handleConvert.bind(this));
    }

    handleDragOver(e) {
        e.preventDefault();
        this.dropZone.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.dropZone.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    async processFile(file) {
        // Reset UI
        this.hideError();
        this.hideResults();
        this.showLoading();

        try {
            // Validate file type
            if (!file.name.toLowerCase().endsWith('.gpkg')) {
                throw new Error('Please select a valid .GPKG file');
            }

            // Read file as ArrayBuffer
            const arrayBuffer = await this.readFileAsArrayBuffer(file);
            
            // Parse GPKG metadata
            const metadata = await this.parseGPKGMetadata(arrayBuffer);
            
            // Filter user fields
            this.userFields = this.filterUserFields(metadata);
            
            // Display results
            this.displayResults(file, metadata);
            
        } catch (error) {
            console.error('Error processing file:', error);
            this.showError(error.message);
        } finally {
            this.hideLoading();
        }
    }

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    async parseGPKGMetadata(arrayBuffer) {
        return new Promise(async (resolve, reject) => {
            try {
                // Initialize SQL.js
                const SQL = await initSqlJs({
                    locateFile: file => file
                });

                // Create a database from the array buffer
                const db = new SQL.Database(new Uint8Array(arrayBuffer));
                
                const metadata = {
                    tables: [],
                    fields: []
                };

                // Get all tables from the database
                const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
                
                if (tablesResult.length === 0) {
                    resolve(metadata);
                    return;
                }

                const tables = tablesResult[0].values;
                
                for (let i = 0; i < tables.length; i++) {
                    const tableName = tables[i][0];
                    
                    // Skip system tables
                    if (tableName.startsWith('sqlite_') || tableName.startsWith('gpkg_')) {
                        continue;
                    }

                    try {
                        // Get table schema
                        const schemaResult = db.exec(`PRAGMA table_info(${tableName})`);
                        
                        if (schemaResult.length > 0) {
                            const table = {
                                name: tableName,
                                fields: []
                            };

                            const columns = schemaResult[0];
                            
                            for (let j = 0; j < columns.values.length; j++) {
                                const column = columns.values[j];
                                const columnInfo = columns.columns;
                                
                                const fieldName = column[columnInfo.indexOf('name')];
                                const fieldType = column[columnInfo.indexOf('type')];
                                const notNull = column[columnInfo.indexOf('notnull')];
                                const primaryKey = column[columnInfo.indexOf('pk')];
                                
                                table.fields.push({
                                    name: fieldName,
                                    type: fieldType,
                                    nullable: notNull === 0,
                                    primaryKey: primaryKey === 1,
                                    tableName: tableName
                                });
                            }

                            metadata.tables.push(table);
                            metadata.fields.push(...table.fields);
                        }
                    } catch (tableError) {
                        console.warn(`Could not read table ${tableName}:`, tableError);
                        continue;
                    }
                }

                db.close();
                resolve(metadata);
                
            } catch (error) {
                reject(new Error('Failed to parse GPKG file: ' + error.message));
            }
        });
    }

    filterUserFields(metadata) {
        // Common geometry and metadata field names to exclude
        const systemFields = new Set([
            'geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape',
            'fid', 'id', 'objectid', 'oid', 'gid',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'version', 'revision', 'uuid', 'guid'
        ]);

        // Common geometry type patterns
        const geometryTypePattern = /^(point|line|polygon|multipoint|multiline|multipolygon|geometry)/i;
        const spatialIndexPattern = /^rtree_.*_(geom|geometry|shape)/i;

        return metadata.fields.filter(field => {
            const lowerName = field.name.toLowerCase();
            
            // Skip primary keys (usually system-generated)
            if (field.primaryKey) return false;
            
            // Skip known system fields
            if (systemFields.has(lowerName)) return false;
            
            // Skip geometry columns by type
            if (field.type && geometryTypePattern.test(field.type)) return false;
            
            // Skip spatial index fields
            if (spatialIndexPattern.test(lowerName)) return false;
            
            // Skip fields that look like internal IDs
            if (lowerName.endsWith('_id') && lowerName.length < 10) return false;
            
            return true;
        });
    }

    displayResults(file, metadata) {
        // Display file summary
        const userFieldCount = this.userFields.length;
        const totalFieldCount = metadata.fields.length;
        const hiddenFieldCount = totalFieldCount - userFieldCount;
        
        this.fileSummary.innerHTML = `
            <h4>📄 ${file.name}</h4>
            <p><strong>Size:</strong> ${this.formatFileSize(file.size)} | <strong>Tables:</strong> ${metadata.tables.length}</p>
            <p><strong>User Fields:</strong> ${userFieldCount} | <strong>Hidden System Fields:</strong> ${hiddenFieldCount}</p>
        `;

        // Display selectable fields
        this.fieldsGrid.innerHTML = '';
        
        if (this.userFields.length === 0) {
            this.fieldsGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #666; padding: 2rem;">No user fields found in this GPKG file.</p>';
        } else {
            this.userFields.forEach((field, index) => {
                const fieldElement = document.createElement('div');
                fieldElement.className = 'field-item';
                fieldElement.innerHTML = `
                    <input type="checkbox" class="field-checkbox" id="field_${index}" data-field-id="${index}">
                    <div class="field-info">
                        <div class="field-name">${field.name}</div>
                        <div class="field-type">${field.type}</div>
                        <div class="field-table">Table: ${field.tableName}</div>
                    </div>
                `;
                
                // Add click handler for the entire field item
                fieldElement.addEventListener('click', (e) => {
                    if (e.target.type !== 'checkbox') {
                        const checkbox = fieldElement.querySelector('.field-checkbox');
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change'));
                    }
                });
                
                // Add change handler for checkbox
                const checkbox = fieldElement.querySelector('.field-checkbox');
                checkbox.addEventListener('change', (e) => {
                    this.handleFieldSelection(index, e.target.checked);
                    fieldElement.classList.toggle('selected', e.target.checked);
                });
                
                this.fieldsGrid.appendChild(fieldElement);
            });
        }

        this.updateConvertButton();
        this.showResults();
    }

    handleFieldSelection(fieldIndex, isSelected) {
        if (isSelected) {
            this.selectedFields.add(fieldIndex);
        } else {
            this.selectedFields.delete(fieldIndex);
        }
        this.updateConvertButton();
    }

    selectAllFields() {
        this.selectedFields.clear();
        const checkboxes = this.fieldsGrid.querySelectorAll('.field-checkbox');
        checkboxes.forEach((checkbox, index) => {
            checkbox.checked = true;
            checkbox.closest('.field-item').classList.add('selected');
            this.selectedFields.add(index);
        });
        this.updateConvertButton();
    }

    selectNoneFields() {
        this.selectedFields.clear();
        const checkboxes = this.fieldsGrid.querySelectorAll('.field-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
            checkbox.closest('.field-item').classList.remove('selected');
        });
        this.updateConvertButton();
    }

    updateConvertButton() {
        const hasSelection = this.selectedFields.size > 0;
        this.convertBtn.disabled = !hasSelection;
        this.convertBtn.textContent = hasSelection 
            ? `Convert ${this.selectedFields.size} Selected Field${this.selectedFields.size === 1 ? '' : 's'} to GeoParquet`
            : 'Convert Selected Fields to GeoParquet';
    }

    handleConvert() {
        // Placeholder for conversion logic
        const selectedFieldNames = Array.from(this.selectedFields).map(index => this.userFields[index].name);
        console.log('Converting fields:', selectedFieldNames);
        alert(`Ready to convert ${selectedFieldNames.length} fields:\n${selectedFieldNames.join(', ')}`);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showLoading() {
        this.dropZone.innerHTML = `
            <div class="drop-zone-content">
                <div class="loading"></div>
                <h3>Processing GPKG file...</h3>
                <p>Analyzing fields and metadata</p>
            </div>
        `;
    }

    hideLoading() {
        this.dropZone.innerHTML = `
            <div class="drop-zone-content">
                <div class="upload-icon">📁</div>
                <h3>Drop your .GPKG file here</h3>
                <p>or click to browse</p>
                <input type="file" id="fileInput" accept=".gpkg" style="display: none;">
            </div>
        `;
        // Re-attach event listener
        this.fileInput = document.getElementById('fileInput');
        this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    }

    showResults() {
        this.results.style.display = 'block';
        this.results.scrollIntoView({ behavior: 'smooth' });
    }

    hideResults() {
        this.results.style.display = 'none';
        this.selectedFields.clear();
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.error.style.display = 'block';
        this.error.scrollIntoView({ behavior: 'smooth' });
    }

    hideError() {
        this.error.style.display = 'none';
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new GPKGMetadataReader();
});

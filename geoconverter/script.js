class GPKGMetadataReader {
    constructor() {
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.results = document.getElementById('results');
        this.error = document.getElementById('error');
        this.fileInfo = document.getElementById('fileInfo');
        this.fieldsList = document.getElementById('fieldsList');
        this.errorMessage = document.getElementById('errorMessage');
        
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
                    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${file}`
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
                                    primaryKey: primaryKey === 1
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

    displayResults(file, metadata) {
        // Display file info
        this.fileInfo.innerHTML = `
            <h4>File Information</h4>
            <p><strong>Name:</strong> ${file.name}</p>
            <p><strong>Size:</strong> ${this.formatFileSize(file.size)}</p>
            <p><strong>Tables:</strong> ${metadata.tables.length}</p>
            <p><strong>Total Fields:</strong> ${metadata.fields.length}</p>
        `;

        // Display fields
        this.fieldsList.innerHTML = '';
        
        if (metadata.tables.length === 0) {
            this.fieldsList.innerHTML = '<p style="color: #666; text-align: center;">No feature tables found in this GPKG file.</p>';
        } else {
            metadata.tables.forEach(table => {
                const tableHeader = document.createElement('div');
                tableHeader.className = 'field-item';
                tableHeader.style.background = '#e3f2fd';
                tableHeader.style.borderLeft = '4px solid #2196f3';
                tableHeader.innerHTML = `
                    <div class="field-name">📋 Table: ${table.name}</div>
                    <div class="field-type">${table.fields.length} fields</div>
                `;
                this.fieldsList.appendChild(tableHeader);

                table.fields.forEach(field => {
                    const fieldElement = document.createElement('div');
                    fieldElement.className = 'field-item';
                    fieldElement.innerHTML = `
                        <div class="field-name">${field.name}</div>
                        <div class="field-type">Type: ${field.type}${field.primaryKey ? ' (Primary Key)' : ''}${field.nullable ? ' (Nullable)' : ''}</div>
                    `;
                    this.fieldsList.appendChild(fieldElement);
                });
            });
        }

        this.showResults();
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
                <p>Please wait while we extract metadata</p>
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

class GeoConverter {
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
        this.currentFile = null;
        this.currentArrayBuffer = null;
        this.fileType = null; // 'gpkg' or 'shapefile'
        
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
        
        // Convert button
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
            // Determine file type
            this.fileType = this.determineFileType(file);
            
            // Validate file type
            if (!this.fileType) {
                throw new Error('Please select a valid .GPKG file or .ZIP shapefile');
            }

            // Store file and read as ArrayBuffer
            this.currentFile = file;
            this.currentArrayBuffer = await this.readFileAsArrayBuffer(file);
            
            let metadata;
            
            // Parse based on file type
            if (this.fileType === 'gpkg') {
                metadata = await this.parseGPKGMetadata(this.currentArrayBuffer);
            } else if (this.fileType === 'shapefile') {
                metadata = await this.parseShapefileMetadata(this.currentArrayBuffer);
            }
            
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

    determineFileType(file) {
        const fileName = file.name.toLowerCase();
        if (fileName.endsWith('.gpkg')) {
            return 'gpkg';
        } else if (fileName.endsWith('.zip')) {
            return 'shapefile';
        }
        return null;
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
                    
                    // Skip system tables and R-tree spatial index tables
                    if (tableName.startsWith('sqlite_') || 
                        tableName.startsWith('gpkg_') || 
                        tableName.startsWith('rtree_')) {
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

    async parseShapefileMetadata(arrayBuffer) {
        return new Promise(async (resolve, reject) => {
            try {
                // Use JSZip to extract the ZIP file
                const JSZip = await this.loadJSZip();
                const zip = new JSZip();
                const zipData = await zip.loadAsync(arrayBuffer);
                
                const metadata = {
                    tables: [],
                    fields: []
                };

                // Find the .dbf file (contains field definitions)
                const dbfFiles = Object.keys(zipData.files).filter(name => name.toLowerCase().endsWith('.dbf'));
                
                if (dbfFiles.length === 0) {
                    throw new Error('No .dbf file found in the ZIP archive');
                }

                // Use the first .dbf file found
                const dbfFileName = dbfFiles[0];
                const dbfData = await zipData.files[dbfFileName].async('arraybuffer');
                
                // Parse DBF header to get field definitions
                const dbfFields = this.parseDBFHeader(dbfData);
                
                // Create a single table for shapefile
                const tableName = dbfFileName.replace('.dbf', '').replace('.DBF', '');
                const table = {
                    name: tableName,
                    fields: dbfFields
                };

                metadata.tables.push(table);
                metadata.fields.push(...dbfFields);
                
                resolve(metadata);
                
            } catch (error) {
                reject(new Error('Failed to parse Shapefile: ' + error.message));
            }
        });
    }

    async loadJSZip() {
        // Load JSZip library dynamically
        if (window.JSZip) {
            return window.JSZip;
        }
        
        // Create script element to load JSZip
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            script.onload = () => resolve(window.JSZip);
            script.onerror = () => reject(new Error('Failed to load JSZip library'));
            document.head.appendChild(script);
        });
    }

    parseDBFHeader(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const fields = [];
        
        // Read DBF header
        const numRecords = view.getUint32(4, true);
        const headerLength = view.getUint16(8, true);
        const recordLength = view.getUint16(10, true);
        
        // Calculate number of fields
        const numFields = (headerLength - 33) / 32;
        
        // Read field definitions (starting at byte 32)
        for (let i = 0; i < numFields; i++) {
            const fieldOffset = 32 + (i * 32);
            
            // Read field name (11 bytes, null-terminated)
            let fieldName = '';
            for (let j = 0; j < 11; j++) {
                const char = view.getUint8(fieldOffset + j);
                if (char === 0) break;
                fieldName += String.fromCharCode(char);
            }
            fieldName = fieldName.trim();
            
            // Read field type (1 byte)
            const fieldType = String.fromCharCode(view.getUint8(fieldOffset + 11));
            
            // Read field length (1 byte)
            const fieldLength = view.getUint8(fieldOffset + 16);
            
            // Read decimal places (1 byte)
            const decimalPlaces = view.getUint8(fieldOffset + 17);
            
            // Convert DBF types to more readable types
            const readableType = this.convertDBFType(fieldType, fieldLength, decimalPlaces);
            
            fields.push({
                name: fieldName,
                type: readableType,
                nullable: true, // DBF fields are generally nullable
                primaryKey: false, // Shapefiles don't have explicit primary keys
                tableName: 'shapefile',
                originalType: fieldType,
                length: fieldLength,
                decimalPlaces: decimalPlaces
            });
        }
        
        return fields;
    }

    convertDBFType(dbfType, length, decimalPlaces) {
        switch (dbfType.toUpperCase()) {
            case 'C': return 'TEXT';
            case 'N': 
                return decimalPlaces > 0 ? 'REAL' : (length > 9 ? 'BIGINT' : 'INTEGER');
            case 'D': return 'DATE';
            case 'L': return 'BOOLEAN';
            case 'M': return 'TEXT'; // Memo fields
            case 'F': return 'REAL'; // Float
            default: return 'TEXT';
        }
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
        const fileTypeName = this.fileType === 'gpkg' ? 'GPKG' : 'Shapefile';
        
        this.fileSummary.innerHTML = `
            <h4>📄 ${file.name} (${fileTypeName})</h4>
            <p><strong>Size:</strong> ${this.formatFileSize(file.size)} | <strong>Tables:</strong> ${metadata.tables.length}</p>
            <p><strong>User Fields:</strong> ${userFieldCount} | <strong>Hidden System Fields:</strong> ${hiddenFieldCount}</p>
        `;

        // Group fields by table
        const fieldsByTable = this.groupFieldsByTable();
        
        // Display grouped fields
        this.fieldsGrid.innerHTML = '';
        
        if (this.userFields.length === 0) {
            this.fieldsGrid.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">No user fields found in this file.</p>';
        } else {
            Object.entries(fieldsByTable).forEach(([tableName, fields]) => {
                const tableGroup = document.createElement('div');
                tableGroup.className = 'table-group';
                
                tableGroup.innerHTML = `
                    <div class="table-header">
                        <h4>
                            <span class="table-icon">📋</span>
                            ${tableName}
                        </h4>
                        <span class="field-count">${fields.length} field${fields.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="table-fields"></div>
                `;
                
                const tableFieldsContainer = tableGroup.querySelector('.table-fields');
                
                fields.forEach((field, index) => {
                    const fieldElement = document.createElement('div');
                    fieldElement.className = 'field-item';
                    fieldElement.innerHTML = `
                        <input type="checkbox" class="field-checkbox" id="field_${field.globalIndex}" data-field-id="${field.globalIndex}">
                        <div class="field-info">
                            <div class="field-name">${field.name}</div>
                            <div class="field-type">${field.type}</div>
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
                        this.handleFieldSelection(field.globalIndex, e.target.checked);
                        fieldElement.classList.toggle('selected', e.target.checked);
                    });
                    
                    tableFieldsContainer.appendChild(fieldElement);
                });
                
                this.fieldsGrid.appendChild(tableGroup);
            });
        }

        this.updateConvertButton();
        this.showResults();
    }

    groupFieldsByTable() {
        const grouped = {};
        
        this.userFields.forEach((field, globalIndex) => {
            if (!grouped[field.tableName]) {
                grouped[field.tableName] = [];
            }
            
            // Add global index for tracking selections
            grouped[field.tableName].push({
                ...field,
                globalIndex
            });
        });
        
        return grouped;
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

    async handleConvert() {
        try {
            this.showConvertingState();
            
            // Get selected field indices
            const selectedFieldIndices = Array.from(this.selectedFields);
            const selectedFields = selectedFieldIndices.map(index => this.userFields[index]);
            
            // Load data based on file type
            let data;
            if (this.fileType === 'gpkg') {
                data = await this.loadGPKGData(selectedFields);
            } else if (this.fileType === 'shapefile') {
                data = await this.loadShapefileData(selectedFields);
            }
            
            // Convert to Arrow format (for now)
            const arrowBuffer = await this.convertToArrow(data, selectedFields);
            
            // Download the file
            this.downloadArrowFile(arrowBuffer, this.currentFile.name);
            
            this.hideConvertingState();
            
        } catch (error) {
            console.error('Conversion error:', error);
            this.showError('Failed to convert file: ' + error.message);
            this.hideConvertingState();
        }
    }

    async loadGPKGData(selectedFields) {
        return new Promise(async (resolve, reject) => {
            try {
                // Initialize SQL.js
                const SQL = await initSqlJs({
                    locateFile: file => file
                });

                // Create database from stored array buffer
                const db = new SQL.Database(new Uint8Array(this.currentArrayBuffer));
                
                const data = {
                    features: [],
                    geometryColumn: null,
                    crs: null,
                    bbox: null
                };

                // Group fields by table
                const fieldsByTable = {};
                selectedFields.forEach(field => {
                    if (!fieldsByTable[field.tableName]) {
                        fieldsByTable[field.tableName] = [];
                    }
                    fieldsByTable[field.tableName].push(field);
                });

                // Process each table
                for (const [tableName, fields] of Object.entries(fieldsByTable)) {
                    // Get all columns for this table to include system fields
                    const allColumnsResult = db.exec(`PRAGMA table_info(${tableName})`);
                    const allColumns = allColumnsResult[0].values.map(row => ({
                        name: row[1],
                        type: row[2],
                        notNull: row[3],
                        primaryKey: row[5]
                    }));

                    // Find geometry column
                    const geometryColumn = allColumns.find(col => 
                        col.name.toLowerCase().includes('geom') || 
                        col.type.toLowerCase().includes('blob')
                    );

                    // Build SELECT query with all necessary fields
                    const selectedFieldNames = fields.map(f => f.name);
                    const systemFields = allColumns.filter(col => 
                        col.primaryKey || 
                        col.name === geometryColumn?.name ||
                        col.name.toLowerCase().includes('geom')
                    ).map(col => col.name);

                    const allFieldNames = [...new Set([...systemFields, ...selectedFieldNames])];
                    const query = `SELECT ${allFieldNames.join(', ')} FROM ${tableName}`;
                    
                    console.log('Executing query:', query);
                    
                    const result = db.exec(query);
                    
                    if (result.length > 0) {
                        const rows = result[0].values;
                        const columns = result[0].columns;
                        
                        rows.forEach(row => {
                            const feature = {};
                            
                            columns.forEach((colName, index) => {
                                const value = row[index];
                                
                                if (colName === geometryColumn?.name) {
                                    // Handle geometry data
                                    if (value && value.byteLength > 0) {
                                        data.geometryColumn = colName;
                                        feature.geometry = this.parseGeometry(value);
                                    }
                                } else {
                                    feature[colName] = value;
                                }
                            });
                            
                            data.features.push(feature);
                        });
                    }
                }

                // Try to get CRS information
                try {
                    const crsResult = db.exec("SELECT srs_id FROM gpkg_spatial_ref_sys LIMIT 1");
                    if (crsResult.length > 0 && crsResult[0].values.length > 0) {
                        data.crs = crsResult[0].values[0][0];
                    }
                } catch (e) {
                    console.warn('Could not determine CRS:', e);
                }

                db.close();
                resolve(data);
                
            } catch (error) {
                reject(new Error('Failed to load GPKG data: ' + error.message));
            }
        });
    }

    async loadShapefileData(selectedFields) {
        // Implementation for loading shapefile data
        // This would extract the actual data from the ZIP file
        // For now, return a placeholder structure
        return {
            features: [],
            geometryColumn: 'geometry',
            crs: null,
            bbox: null
        };
    }

    parseGeometry(blob) {
        try {
            const buffer = new Uint8Array(blob);
            const view = new DataView(buffer.buffer);
            
            // Read byte order
            const byteOrder = view.getUint8(0);
            const littleEndian = byteOrder === 1;
            
            // Read geometry type
            const geometryType = view.getUint32(1, littleEndian);
            
            // For now, return a simple representation
            return {
                type: this.getGeometryTypeName(geometryType),
                coordinates: [], // Would contain actual coordinates
                wkb: blob // Store original WKB for now
            };
        } catch (error) {
            console.warn('Could not parse geometry:', error);
            return null;
        }
    }

    getGeometryTypeName(type) {
        const types = {
            1: 'Point',
            2: 'LineString', 
            3: 'Polygon',
            4: 'MultiPoint',
            5: 'MultiLineString',
            6: 'MultiPolygon',
            7: 'GeometryCollection'
        };
        return types[type] || 'Unknown';
    }

    async convertToArrow(data, selectedFields) {
        try {
            // Create Arrow table from the data
            const table = this.createArrowTable(data, selectedFields);
            
            // For now, since we don't have a proper Parquet writer in the browser,
            // let's export as Arrow IPC format (which is close to Parquet)
            const buffer = Arrow.tableToIPC(table, 'file');
            
            return buffer;
        } catch (error) {
            console.error('Parquet conversion error:', error);
            throw new Error('Failed to convert to Parquet: ' + error.message);
        }
    }

    createArrowTable(data, selectedFields) {
        // Create arrays for each column
        const columns = {};
        const geometryColumn = data.geometryColumn;
        
        // Initialize arrays
        selectedFields.forEach(field => {
            columns[field.name] = [];
        });
        
        if (geometryColumn) {
            columns[geometryColumn] = [];
        }
        
        // Populate arrays from features
        data.features.forEach(feature => {
            selectedFields.forEach(field => {
                const value = feature[field.name];
                columns[field.name].push(value !== null ? value : null);
            });
            
            if (geometryColumn && feature.geometry) {
                // Convert geometry to WKB bytes for storage
                columns[geometryColumn].push(feature.geometry.wkb || null);
            } else if (geometryColumn) {
                columns[geometryColumn].push(null);
            }
        });
        
        // Create Arrow vectors using the correct API
        const vectors = {};
        
        Object.entries(columns).forEach(([columnName, values]) => {
            if (columnName === geometryColumn) {
                // Handle geometry column as binary data
                vectors[columnName] = Arrow.vectorFromArray(values, new Arrow.Binary());
            } else {
                // Handle regular columns
                const field = selectedFields.find(f => f.name === columnName);
                if (field) {
                    const arrowType = this.getArrowType(field.type);
                    vectors[columnName] = Arrow.vectorFromArray(values, arrowType);
                }
            }
        });
        
        // Create Arrow table using the correct API
        const table = Arrow.tableFromArrays(vectors);
        
        return table;
    }

    getArrowType(sqliteType) {
        const typeMap = {
            'TEXT': new Arrow.Utf8(),
            'VARCHAR': new Arrow.Utf8(),
            'CHAR': new Arrow.Utf8(),
            'INTEGER': new Arrow.Int32(),
            'INT': new Arrow.Int32(),
            'BIGINT': new Arrow.Int64(),
            'REAL': new Arrow.Float64(),
            'FLOAT': new Arrow.Float64(),
            'DOUBLE': new Arrow.Float64(),
            'BOOLEAN': new Arrow.Bool(),
            'BOOL': new Arrow.Bool(),
            'DATE': new Arrow.DateDay(),
            'DATETIME': new Arrow.TimestampMillisecond(),
            'BLOB': new Arrow.Binary()
        };
        
        return typeMap[sqliteType.toUpperCase()] || new Arrow.Utf8();
    }

    calculateBBox(features) {
        // Calculate bounding box from features
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                // In a real implementation, you'd traverse the coordinates
                // For now, return a default bbox
            }
        });
        
        return [minX, minY, maxX, maxY];
    }

    downloadArrowFile(buffer, originalFileName) {
        const fileName = originalFileName.replace('.gpkg', '_converted.arrow').replace('.zip', '_converted.arrow');
        
        const blob = new Blob([buffer], {
            type: 'application/octet-stream'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Show success message
        this.showSuccess(`Successfully converted ${this.selectedFields.size} fields to Arrow format!`);
    }

    showConvertingState() {
        this.convertBtn.disabled = true;
        this.convertBtn.innerHTML = `
            <div class="loading"></div>
            Converting to GeoParquet...
        `;
    }

    hideConvertingState() {
        this.convertBtn.disabled = false;
        this.updateConvertButton();
    }

    showSuccess(message) {
        // Create a success notification
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.innerHTML = `
            <div class="success-content">
                <span class="success-icon">✅</span>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
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
                <h3>Processing file...</h3>
                <p>Analyzing fields and metadata</p>
            </div>
        `;
    }

    hideLoading() {
        this.dropZone.innerHTML = `
            <div class="drop-zone-content">
                <div class="upload-icon">📁</div>
                <h3>Drop your .GPKG or .ZIP shapefile here</h3>
                <p>or click to browse</p>
                <input type="file" id="fileInput" accept=".gpkg,.zip" style="display: none;">
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
    new GeoConverter();
});

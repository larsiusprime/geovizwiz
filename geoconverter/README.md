# GPKG Metadata Reader

A simple, standalone web application that reads and displays metadata from GeoPackage (.GPKG) files directly in your browser. No server required - everything runs locally!

## Features

- **Drag & Drop Interface**: Simply drag and drop your .GPKG file onto the designated area
- **Click to Browse**: Alternatively, click the drop zone to browse and select a file
- **Local Processing**: All file processing happens in your browser - no data is sent to any server
- **Metadata Display**: Shows file information and field details including:
  - File name and size
  - Number of tables and fields
  - Field names and data types
  - Primary key and nullable information
- **Modern UI**: Clean, responsive design that works on desktop and mobile devices
- **Error Handling**: Clear error messages for invalid files or processing issues

## How to Use

1. **Open the Application**: Simply open `index.html` in any modern web browser
2. **Load a GPKG File**: 
   - Drag and drop a .GPKG file onto the drop zone, OR
   - Click the drop zone to browse and select a file
3. **View Results**: The application will display the file metadata and field information

## Technical Details

### Dependencies
- **sql.js**: A JavaScript SQLite implementation for reading database files in the browser
- **All dependencies are local**: The application is completely self-contained and works offline

### Browser Compatibility
- Modern browsers with ES6+ support
- Chrome, Firefox, Safari, Edge (latest versions)
- Requires FileReader API support

### File Processing
- Files are read as ArrayBuffer for efficient processing
- Only metadata is extracted - no actual data is loaded into memory
- Processing happens entirely in the browser
- All dependencies are local - no internet connection required

## File Structure

```
geoconverter/
├── index.html          # Main HTML file
├── styles.css          # CSS styles
├── script.js           # JavaScript application logic
├── sql-wasm.js         # SQL.js library (local copy)
├── sql-wasm.wasm       # SQL.js WebAssembly binary (local copy)
└── README.md           # This file
```

## Limitations

- Only reads feature tables (not tile tables or other GPKG content types)
- Requires modern browser with good JavaScript performance for large files
- File size limitations may apply based on browser memory constraints

## Development

To modify or extend the application:

1. **Adding New Features**: Modify `script.js` to add new functionality
2. **Styling Changes**: Update `styles.css` for visual modifications
3. **UI Changes**: Edit `index.html` for structural changes

## License

This is a simple utility application. Feel free to use and modify as needed.

## Troubleshooting

**"Failed to parse GPKG file"**: 
- Ensure the file is a valid GeoPackage (.GPKG) file
- Try with a smaller file if the current one is very large

**"No feature tables found"**:
- The GPKG file may not contain feature tables
- Some GPKG files only contain tile data or other content types

**Browser compatibility issues**:
- Update to the latest version of your browser
- Try a different browser if issues persist

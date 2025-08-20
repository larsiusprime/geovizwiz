cd L:\git\geovizwiz\viz

:: install dev tools (if not already)
npm i -D vite typescript

:: add vite scripts to package.json
npm set-script dev "vite"
npm set-script build "vite build"
npm set-script preview "vite preview --host --port 4173"

:: install deps (if not already)
npm i maplibre-gl geoparquet hyparquet-compressors @ngageoint/geopackage wkx shpjs fflate

:: run
npm run dev
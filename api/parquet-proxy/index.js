const https = require('https');

const BLOB_STORAGE_BASE = 'https://landeconomics.blob.core.windows.net/public-sharing-cle';

module.exports = async function (context, req) {
  try {
    const filename = context.bindingData.filename || req.params?.filename;
    if (!filename) {
      context.res = { status: 400, body: 'Filename required' };
      return;
    }

    // Validate filename to prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      context.res = { status: 400, body: 'Invalid filename' };
      return;
    }

    const blobUrl = `${BLOB_STORAGE_BASE}/${filename}`;
    context.log(`[Parquet Proxy] Fetching: ${blobUrl}`);

    // Handle OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
      context.res = {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Content-Type',
          'Access-Control-Max-Age': '3600'
        }
      };
      return;
    }

    // Parse Range header if present
    const rangeHeader = req.headers['range'] || req.headers['Range'] || '';
    const headers = {};
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    // Fetch from Azure Blob Storage
    const url = new URL(blobUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      method: req.method || 'GET',
      headers: headers
    };

    await new Promise((resolve, reject) => {
      const blobReq = https.request(options, (blobRes) => {
        const chunks = [];
        
        blobRes.on('data', (chunk) => {
          chunks.push(chunk);
        });

        blobRes.on('end', () => {
          const responseHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Content-Type',
            'Content-Type': blobRes.headers['content-type'] || 'application/octet-stream'
          };

          // Forward Content-Range header for partial content responses
          if (blobRes.headers['content-range']) {
            responseHeaders['Content-Range'] = blobRes.headers['content-range'];
          }

          // Forward Content-Length
          if (blobRes.headers['content-length']) {
            responseHeaders['Content-Length'] = blobRes.headers['content-length'];
          }

          // Set status code (206 for partial content, 200 for full)
          const status = blobRes.statusCode || 200;

          context.res = {
            status: status,
            headers: responseHeaders,
            body: Buffer.concat(chunks)
          };
          resolve();
        });
      });

      blobReq.on('error', (error) => {
        context.log.error('[Parquet Proxy] Error:', error);
        context.res = {
          status: 502,
          body: `Failed to fetch from blob storage: ${error.message}`
        };
        reject(error);
      });

      blobReq.end();
    });

  } catch (err) {
    context.log.error('[Parquet Proxy] Error:', err);
    context.res = {
      status: 500,
      body: `Proxy error: ${err.message}`
    };
  }
};


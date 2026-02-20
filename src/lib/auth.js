const http = require('http');
const { exec } = require('child_process');
const { saveApiKey } = require('./settings');

const AUTH_URL = 'https://memorystack.app/dashboard/api-keys';
const AUTH_TIMEOUT = 120000; // 2 minutes

/**
 * Start browser-based auth flow
 * Opens browser to MemoryStack dashboard and waits for API key via localhost callback
 */
async function startAuthFlow() {
    return new Promise((resolve, reject) => {
        // Create local server to receive callback
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost`);
            const apiKey = url.searchParams.get('key');

            if (apiKey && apiKey.startsWith('ms_')) {
                // Save the API key
                saveApiKey(apiKey);

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>MemoryStack Connected</title></head>
          <body style="font-family: system-ui; text-align: center; padding: 50px;">
            <h1>✅ MemoryStack Connected!</h1>
            <p>You can close this window and return to Claude Code.</p>
          </body>
          </html>
        `);

                server.close();
                resolve(apiKey);
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid API key');
            }
        });

        // Find an available port
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const callbackUrl = `http://localhost:${port}`;

            console.error(`[MemoryStack] Opening browser for authentication...`);
            console.error(`[MemoryStack] If browser doesn't open, visit: ${AUTH_URL}`);
            console.error(`[MemoryStack] Then add ?callback=${encodeURIComponent(callbackUrl)} to the URL`);

            // Open browser
            const openCmd = process.platform === 'win32' ? 'start' :
                process.platform === 'darwin' ? 'open' : 'xdg-open';

            exec(`${openCmd} "${AUTH_URL}?callback=${encodeURIComponent(callbackUrl)}"`);
        });

        // Timeout
        setTimeout(() => {
            server.close();
            reject(new Error('AUTH_TIMEOUT'));
        }, AUTH_TIMEOUT);

        server.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = { startAuthFlow };

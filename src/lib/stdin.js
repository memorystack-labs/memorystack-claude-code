/**
 * Read JSON from stdin (Claude Code hook protocol)
 */
async function readStdin() {
    return new Promise((resolve, reject) => {
        let data = '';

        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });

        process.stdin.on('end', () => {
            try {
                // Strip UTF-8 BOM (PowerShell on Windows adds this)
                const cleaned = data.replace(/^\uFEFF/, '').trim();
                if (!cleaned) {
                    resolve({});
                    return;
                }
                resolve(JSON.parse(cleaned));
            } catch (err) {
                reject(new Error(`Failed to parse stdin: ${err.message}`));
            }
        });

        process.stdin.on('error', reject);

        // Timeout after 5 seconds
        setTimeout(() => {
            if (!data) {
                resolve({});
            }
        }, 5000);
    });
}

/**
 * Write JSON output to stdout
 */
function writeOutput(output) {
    console.log(JSON.stringify(output));
}

module.exports = { readStdin, writeOutput };

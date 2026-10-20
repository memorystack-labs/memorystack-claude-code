const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const srcDir = path.join(__dirname, '..', 'src');
const outDir = path.join(__dirname, '..', 'plugin', 'scripts');

// Ensure output directory exists
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// Files to bundle
const entryPoints = [
    'lifecycle-hook.js',
    'context-hook.js',
    'summary-hook.js',
    'prompt-hook.js',
    'tool-hook.js',
    'subagent-hook.js',
    'task-hook.js',
    'add-memory.js',
    'search-memory.js',
    'save-project-memory.js',
];

async function build() {
    console.log('Building MemoryStack Claude Code plugin...');

    for (const entry of entryPoints) {
        const inputPath = path.join(srcDir, entry);
        const outputPath = path.join(outDir, entry.replace('.js', '.cjs'));

        if (!fs.existsSync(inputPath)) {
            console.log(`Skipping ${entry} (not found)`);
            continue;
        }

        try {
            await esbuild.build({
                entryPoints: [inputPath],
                bundle: true,
                platform: 'node',
                target: 'node18',
                outfile: outputPath,
                format: 'cjs',
                minify: false,
                sourcemap: false,
                external: [],
            });
            console.log(`Built: ${entry} -> ${path.basename(outputPath)}`);
        } catch (err) {
            console.error(`Failed to build ${entry}:`, err.message);
            process.exit(1);
        }
    }

    await esbuild.build({
        entryPoints: [path.join(srcDir, 'memory-server.mjs')], bundle: true,
        platform: 'node', target: 'node18', format: 'esm',
        outfile: path.join(outDir, 'memory-server.mjs'),
        banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    });
    console.log('Build complete!');
}

build();

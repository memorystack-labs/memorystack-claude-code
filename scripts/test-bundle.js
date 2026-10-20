const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', 'tests/*.test.cjs', 'tests/engine/*.test.mjs'], {
  cwd: path.join(__dirname, '..'), stdio: 'inherit',
  env: { ...process.env, MEMORYSTACK_TEST_SERVER: path.join(__dirname, '../plugin/scripts/memory-server.mjs') },
});
process.exit(result.status ?? 1);

/** Bounded, fail-open Claude Code command-hook protocol. */
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '', finished = false;
    const timer = setTimeout(() => finish(null, {}), 1500);
    timer.unref();
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > 1048576) finish(new Error('Hook input exceeds 1 MiB'));
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(data.replace(/^\uFEFF/, '').trim() || '{}')); }
      catch { finish(new Error('Invalid hook JSON')); }
    };
    const onError = error => finish(error);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}
function writeOutput(output) { console.log(JSON.stringify(output)); }
module.exports = { readStdin, writeOutput };

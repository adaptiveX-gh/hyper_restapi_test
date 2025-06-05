const fs = require('fs');
const path = require('path');

const patterns = [
  /#fff(?![0-9a-f])/i,
  /#f6f7fa/i,
  /#f7f7f7/i,
  /#ddd\b/i,
  /#e2e5eb/i,
  /#fbfcfd/i,
  /#f0f4f8/i,
  /#f3f5f9/i
];

const ignore = [
  path.join('public', 'css', 'tokens.css'),
  'mockup.html'
];

function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name), callback);
    } else {
      callback(path.join(dir, entry.name));
    }
  }
}

function checkFile(file) {
  if (ignore.some(i => file.endsWith(i))) return;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (/color:\s*#fff/i.test(line)) return;
    patterns.forEach(p => {
      if (p.test(line)) {
        console.error(`${file}:${idx + 1}: disallowed colour found: ${line.trim()}`);
        process.exitCode = 1;
      }
    });
  });
}

walk('public', checkFile);
if (process.exitCode) {
  console.error('Literal colour codes detected. Use CSS tokens instead.');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');

const mapping = {
  '#ffffff': 'var(--bg-0)',
  '#fff': 'var(--bg-0)',
  '#f7f7f7': 'var(--bg-1)',
  '#fafafa': 'var(--bg-1)',
  '#f0f0f0': 'var(--bg-1)',
  '#e9ebef': 'var(--bg-2)',
  '#ddd': 'var(--bg-2)',
  '#dcdcdc': 'var(--bg-2)',
  '#28c76f': 'var(--up)',
  '#ff5252': 'var(--down)',
  '#ff4d4d': 'var(--down)',
  '#d0d5da': 'var(--border)',
  '#e5e7eb': 'var(--border)'
};

function replaceColours(content) {
  let result = content;
  for (const [hex, token] of Object.entries(mapping)) {
    const regex = new RegExp(hex, 'gi');
    result = result.replace(regex, token);
  }
  return result;
}

function processFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const updated = replaceColours(text);
  fs.writeFileSync(file, updated, 'utf8');
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node replaceColors.js <file ...>');
  process.exit(1);
}
files.forEach(processFile);


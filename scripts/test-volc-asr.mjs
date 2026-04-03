#!/usr/bin/env node
import fs from 'node:fs/promises';

const [,, filePath] = process.argv;
if (!filePath) {
  console.error('Usage: node scripts/test-volc-asr.mjs <wav-file>');
  process.exit(1);
}

const file = await fs.readFile(filePath);
const form = new FormData();
form.append('file', new Blob([file], { type: 'audio/wav' }), filePath.split('/').pop());

const res = await fetch('http://localhost:3000/api/asr/transcribe-file', {
  method: 'POST',
  body: form,
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (!res.ok) process.exit(1);

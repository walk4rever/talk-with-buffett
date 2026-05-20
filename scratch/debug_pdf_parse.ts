import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
console.log('pdf type:', typeof pdf);
console.log('pdf keys:', Object.keys(pdf));

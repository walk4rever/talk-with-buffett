import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

async function test() {
    const dataBuffer = fs.readFileSync('/Users/rafael/R129/Vault/Buffett-and-Munger-Unscripted.pdf');
    const data = await pdf(dataBuffer);
    console.log('Text length:', data.text.length);
    console.log('Sample text:', data.text.slice(0, 500));
}

test().catch(console.error);

#!/usr/bin/env node
import pkg from '@next/env';
const { loadEnvConfig } = pkg;
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectDir = join(__dirname, '..');

// 加载环境变量
loadEnvConfig(projectDir);

// 现在导入我们的 ASR 客户端（需要先编译成 CommonJS 或者我们用另一种方式）
console.log('环境变量已加载:');
console.log('VOLCENGINE_ASR_APP_ID:', process.env.VOLCENGINE_ASR_APP_ID ? '已设置' : '未设置');
console.log('VOLCENGINE_ASR_ACCESS_TOKEN:', process.env.VOLCENGINE_ASR_ACCESS_TOKEN ? '已设置' : '未设置');
console.log('VOLCENGINE_ASR_CLUSTER:', process.env.VOLCENGINE_ASR_CLUSTER);
console.log('VOLCENGINE_ASR_WS_URL:', process.env.VOLCENGINE_ASR_WS_URL);
console.log('VOLCENGINE_ASR_RESOURCE_ID:', process.env.VOLCENGINE_ASR_RESOURCE_ID);
console.log('\n配置看起来正确！现在你可以:');
console.log('1. 启动开发服务器: npm run dev');
console.log('2. 使用 test-volc-asr.mjs 脚本测试，需要一个 WAV 文件');
console.log('3. 或者在应用中直接测试语音识别功能');

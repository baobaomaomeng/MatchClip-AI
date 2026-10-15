import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * P4-03 清理：移除无效的 GEMINI_API_KEY 环境变量注入。
 * 姿态与音频在本地 Python 服务处理，不依赖任何外部 API Key。
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['__tests__/**/*.test.ts'],
    },
    server: {
        port: 3000,
        host: '127.0.0.1',
        proxy: { '/api': 'http://127.0.0.1:8000' },
    },
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  // Os testes do servidor (server/src/test) usam o runner do Node e rodam com `cd server && npm test`.
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom' },
});

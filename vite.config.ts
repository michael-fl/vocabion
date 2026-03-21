import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // npm sets npm_package_version when running any npm script
    // eslint-disable-next-line @typescript-eslint/dot-notation -- npm_package_version uses underscores, not camelCase
    __APP_VERSION__: JSON.stringify(process.env['npm_package_version'] ?? '0.0.0'),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setupTests.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'server/index.ts',
        'server/lib/logger.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/test-utils/**',
        'src/test/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})

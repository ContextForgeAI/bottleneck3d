import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  // Project site: https://contextforgeai.github.io/bottleneck3d/
  base: mode === 'pages' ? '/bottleneck3d/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
}))

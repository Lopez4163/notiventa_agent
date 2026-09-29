import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { PRELOAD_OUTPUT_FILENAME } from './src/shared/build-artifacts'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __NOTIVENTA_AGENT_PACKAGED_ENVIRONMENT__: JSON.stringify(
        process.env.NOTIVENTA_AGENT_PACKAGE_ENV ?? null
      ),
      __NOTIVENTA_AGENT_PACKAGED_BACKEND_URL__: JSON.stringify(
        process.env.NOTIVENTA_AGENT_PACKAGE_BACKEND_URL ?? null
      )
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: PRELOAD_OUTPUT_FILENAME
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})

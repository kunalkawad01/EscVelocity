import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // TEMPORARY: pointed at 8001 because 8000 has an orphaned listener
        // (owning PID doesn't exist in the OS process table, can't be killed).
        // Revert to 8000 after a reboot clears it.
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})

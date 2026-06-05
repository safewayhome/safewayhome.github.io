import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// This board is the root user site (https://tlangstrom.github.io/), so the production base is '/'.
// The Actions workflow passes BOARD_BASE explicitly ('/' for a *.github.io repo, '/<repo>/' for a
// project repo), so this default just needs to be correct for the root-site case + local dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BOARD_BASE || '/') : '/',
  plugins: [react()],
  server: { port: 5180, host: true },
  preview: { port: 5180 },
}))

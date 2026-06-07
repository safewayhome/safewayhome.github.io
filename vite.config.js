import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

// This board is the root user site (https://tlangstrom.github.io/), so the production base is '/'.
// The Actions workflow passes BOARD_BASE explicitly ('/' for a *.github.io repo, '/<repo>/' for a
// project repo), so this default just needs to be correct for the root-site case + local dev.
//
// Multi-page: utöver tavlan (index.html) bygger vi den fristående, publika undersidan /ideel
// (ideel/index.html -> dist/ideel/index.html, serveras på ledmig.nu/ideel). Den är medvetet skild
// från den inloggningsgrindade dev-tavlan: en egen, lätt bundle utan reactflow/presence.
const entry = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BOARD_BASE || '/') : '/',
  plugins: [react()],
  // OWASP A05 (CSP-kompatibilitet): stäng av Vite:s modulepreload-polyfill så att bygget inte injicerar
  // något inline-<script>. Då kan vår Content-Security-Policy köra strikt "script-src 'self'" utan
  // 'unsafe-inline'. Polyfillen behövs bara för äldre webbläsare; appen fungerar ändå utan den.
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        ideel: entry('./ideel/index.html'),
      },
    },
  },
  server: { port: 5180, host: true },
  preview: { port: 5180 },
}))

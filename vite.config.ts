import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// VITE_BASE is only needed when the site lives in a sub-folder (for example GitHub Pages: /oms/).
export default defineConfig({ plugins: [react()], base: process.env.VITE_BASE || '/' })

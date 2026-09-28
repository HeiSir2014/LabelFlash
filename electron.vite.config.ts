import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// electron-vite 5 默认把 dependencies 外部化（qrcode 走 node_modules）。
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
});

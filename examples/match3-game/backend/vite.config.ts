import { defineConfig } from 'vite'
import { resolve } from 'path'

// goja 直接 vm.RunString() 执行：IIFE 单文件、无依赖、可读性优先（不压缩）。
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/game.ts'),
      name: 'Match3Game',
      formats: ['iife'],
      fileName: () => 'game.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2015',
    minify: false,
  },
})

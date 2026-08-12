import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: [
    'react',
    'react-dom',
    'remotion',
    '@remotion/player',
    'framer-motion',
    '@dnd-kit/modifiers',
    '@clash/remotion-core',
    '@clash/remotion-components'
  ],
  treeshake: true,
})
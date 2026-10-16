import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    observable: 'src/observable/index.ts',
    react: 'src/react/index.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2019',
  platform: 'neutral',
  sourcemap: true,
  dts: true,
  clean: true,
});

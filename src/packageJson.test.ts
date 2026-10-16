// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageJson {
  types: string;
  exports: Record<string, string | { require: { types: string } }>;
  typesVersions: Record<string, Record<string, string[]>>;
}

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
) as PackageJson;

describe('package.json', () => {
  it('maps every entry point for resolvers that ignore exports', () => {
    const entries = Object.entries(packageJson.exports).filter(
      ([path]) => path !== '.' && path !== './package.json',
    );

    expect(entries.length).toBeGreaterThan(0);
    expect(packageJson.typesVersions).toEqual({
      '*': Object.fromEntries(
        entries.map(([path, target]) => [
          path.slice(2),
          [(target as { require: { types: string } }).require.types],
        ]),
      ),
    });
  });

  it('points the root types at the types of the root entry point', () => {
    const root = packageJson.exports['.'] as { require: { types: string } };

    expect(packageJson.types).toBe(root.require.types);
  });
});

// Builds the Vercel Functions of the Command Center (design.md section 11.3, step 3).
//
// Why: package.json says "type": "module", our TypeScript uses extensionless relative imports, and Vercel compiles an api/*.ts file on its own without resolving
// them. The first deploy failed with ERR_MODULE_NOT_FOUND for that reason. So each function source in `functions/` is bundled by esbuild into ONE file with every
// import inlined (only Node built-ins stay as imports). The generated files go to `api/` (git-ignored), which is where Vercel looks for functions.
//
//   functions/snapshot.ts -> api/snapshot.js     GET /api/snapshot
//   functions/live.ts     -> api/live.js         GET /api/live
//   functions/docs.ts     -> api/docs.js         GET /api/docs?path=<repo path>  (vercel.json rewrites /api/docs/:path* to it)
//
// Run:  node scripts/build-functions.mjs [outDir]      (outDir defaults to api/)   vercel.json runs it after `vite build`.

import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The functions: the name of the output file (without .js) and the source. */
export const FUNCTIONS = [
  { name: 'snapshot', source: 'functions/snapshot.ts' },
  { name: 'live', source: 'functions/live.ts' },
  { name: 'docs', source: 'functions/docs.ts' },
];

/**
 * Bundles every function into `outDir`. Returns one entry per file: its path and its size in bytes.
 * @param {{ outDir?: string }} [options]
 */
export async function buildFunctions({ outDir = join(PACKAGE_DIR, 'api') } = {}) {
  mkdirSync(outDir, { recursive: true });
  const built = [];
  for (const { name, source } of FUNCTIONS) {
    const outfile = join(outDir, `${name}.js`);
    await build({
      entryPoints: [join(PACKAGE_DIR, source)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      // Some packages that get bundled use `require` for Node built-ins. A bundled ES module has none, so this gives it one.
      banner: { js: "import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);" },
      logLevel: 'warning',
    });
    built.push({ file: outfile, name, bytes: statSync(outfile).size });
  }
  return built;
}

// Run as a script (not when a test imports it).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
  const built = await buildFunctions(outDir === undefined ? {} : { outDir });
  for (const entry of built) console.log(`${relative(process.cwd(), entry.file) || entry.file}  ${entry.bytes} bytes`);
}

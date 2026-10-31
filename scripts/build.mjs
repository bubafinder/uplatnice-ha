// Builds the web app (single self-contained HTML file) and the server bundle into dist/.
//   node scripts/build.mjs            – production build
// Optional env: BUILD_OVERRIDES=<file.mjs> exporting { esbuildPath, alias, nodePaths } (offline development)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overrides = process.env.BUILD_OVERRIDES ? (await import(pathToFileURL(path.resolve(process.env.BUILD_OVERRIDES)).href)).default : {};
const esbuild = await import(overrides.esbuildPath ?? 'esbuild');
const require = createRequire(path.join(root, 'package.json'));
const resolvePkg = id => {
  if (overrides.alias?.[id]) return overrides.alias[id];
  for (const p of [root, ...(overrides.nodePaths ?? [])]) {
    try { return createRequire(path.join(p, 'x.js')).resolve(id); } catch { /* next */ }
  }
  return require.resolve(id);
};

const shim = path.join(root, 'scripts/shims/empty.js');
const alias = {
  // optional jsPDF features that are never used
  canvg: shim,
  html2canvas: shim,
  dompurify: shim,
  ...(overrides.alias ?? {}),
};

/** Loads the pdf.js worker source as a string (it runs from a Blob URL). */
const workerTextPlugin = {
  name: 'pdfjs-worker-text',
  setup(build) {
    build.onResolve({ filter: /^pdfjs-worker-text$/ }, () => ({ path: resolvePkg('pdfjs-dist/build/pdf.worker.min.mjs'), namespace: 'worker-text' }));
    build.onLoad({ filter: /.*/, namespace: 'worker-text' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};

const common = {
  bundle: true,
  alias,
  nodePaths: overrides.nodePaths ?? [],
  legalComments: 'none',
  logLevel: 'warning',
};

export async function buildWeb({ outFile = path.join(root, 'dist/web/index.html') } = {}) {
  const r = await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/web/main.tsx')],
    format: 'esm',
    platform: 'browser',
    target: ['chrome110', 'safari16'],
    minify: true,
    write: false,
    jsx: 'automatic',
    loader: { '.ttf': 'base64' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [workerTextPlugin],
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync(path.join(root, 'src/web/ui/styles.css'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'src/web/index.html'), 'utf8');
  const html = template.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log(`${path.relative(root, outFile)} ${(html.length / 1024).toFixed(0)} KB`);
}

export async function buildServer({ outFile = path.join(root, 'dist/server.mjs') } = {}) {
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/server/main.ts')],
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: outFile,
    banner: { js: '// Uplatnice server bundle' },
  });
  console.log(path.relative(root, outFile));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildWeb();
  await buildServer();
}

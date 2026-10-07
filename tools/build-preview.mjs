// Builds preview/index.html: one self-contained file with the game's own JS and CSS inlined.
// three.js and cannon-es still load from the pinned CDN importmap. It runs in a sandboxed iframe
// without allow-same-origin: storage access is wrapped in try/catch, so nothing persists there.
// Usage: node tools/build-preview.mjs        (zero dependencies: a tiny module concatenator below;
//        if `esbuild` is installed it is used instead and the output is minified)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');

async function withEsbuild() {
  const esbuild = await import('esbuild');
  const res = await esbuild.build({ entryPoints: [join(root, 'src/main.js')], bundle: true, format: 'esm', write: false, target: 'es2020', external: ['three', 'three/addons/*', 'cannon-es'], legalComments: 'none', minify: true });
  return res.outputFiles[0].text;
}

/** Minimal bundler for this codebase's ES module style: each local module is wrapped in a
 *  function scope; local imports become references to earlier modules; bare imports are hoisted. */
function miniBundle() {
  const order = []; const seen = new Set(); const external = new Map(); const bodies = {};
  const visit = (file) => {
    if (seen.has(file)) return; seen.add(file);
    let code = src(file);
    const deps = [...code.matchAll(/from\s+'\.\/([\w-]+\.js)'/g), ...code.matchAll(/import\('\.\/([\w-]+\.js)'\)/g)].map((m) => m[1]);
    deps.forEach(visit);
    const id = (f) => `__m_${f.replace(/\W/g, '_')}`;
    const exportsList = [];
    // imports
    code = code.replace(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';?\s*$/gm, (all, what, from) => {
      if (from.startsWith('./')) {
        const mod = id(from.slice(2));
        if (/^\*\s+as\s+(\w+)$/.test(what)) return `const ${what.match(/^\*\s+as\s+(\w+)$/)[1]} = ${mod};`;
        return `const ${what.replace(/\s+as\s+/g, ': ')} = ${mod};`;
      }
      const key = `${what}|${from}`; if (!external.has(key)) external.set(key, `import ${what} from '${from}';`);
      return '';
    });
    code = code.replace(/import\('\.\/([\w-]+\.js)'\)/g, (a, f) => `Promise.resolve(${id(f)})`);
    // re-exports: export { a, b } from './x.js'  and  export { a, b };
    code = code.replace(/^export\s+\{([^}]*)\}\s*from\s+'\.\/([\w-]+\.js)';?\s*$/gm, (a, names, f) => { names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exportsList.push(`${n}: ${id(f)}.${n}`)); return ''; });
    code = code.replace(/^export\s+\{([^}]*)\};?\s*$/gm, (a, names) => { names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => { const [l, r] = n.split(/\s+as\s+/); exportsList.push(`${(r || l).trim()}: ${l.trim()}`); }); return ''; });
    code = code.replace(/^export\s+(async\s+function|function|class|const|let)\s+([\w$]+)/gm, (a, kw, name) => { exportsList.push(name); return `${kw} ${name}`; });
    bodies[file] = `const ${id(file)} = (() => {\n${code}\nreturn { ${exportsList.join(', ')} };\n})();`;
    order.push(file);
  };
  visit('main.js');
  return `${[...external.values()].join('\n')}\n${order.map((f) => bodies[f]).join('\n')}`;
}

let js; let how;
try { js = await withEsbuild(); how = 'esbuild'; } catch { js = miniBundle(); how = 'mini-bundler'; }
js = js.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'styles.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script type="module">\n${js}\n</script>`);
if (html.includes('src="src/') || html.includes('href="styles.css"')) throw new Error('local reference left in preview');
mkdirSync(join(root, 'preview'), { recursive: true });
writeFileSync(join(root, 'preview/index.html'), html);
console.log(`preview/index.html written via ${how} (${(html.length / 1024).toFixed(0)} KB)`);

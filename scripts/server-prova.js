// Prova di Lampada web sul Mac, senza la finestra di scelta della cartella:
//   node scripts/server-prova.js <cartella del vault> [porta]  →  apri l'indirizzo che scrive.
// Legge il vault vero ma non lo modifica: le scritture restano in memoria finché il server è acceso.
const http = require('http');
const fs = require('fs');
const path = require('path');

const vault = path.resolve(process.argv[2] || '.');
const port = +(process.argv[3] || 8123);
const page = path.join(__dirname, '..', 'dist', 'lampada.html');
const mem = new Map(); // percorso → Buffer (scritto dalla pagina)
const gone = new Set(); // percorsi tolti dalla pagina
const dirs = new Set();

const real = (p) => {
  const full = path.join(vault, p);
  if (full !== vault && !full.startsWith(vault + path.sep)) throw new Error('fuori dal vault');
  return full;
};
const under = (p, d) => (d ? p.startsWith(`${d}/`) : true);

function list(d) {
  const out = { files: new Set(), folders: new Set() };
  try {
    for (const e of fs.readdirSync(real(d), { withFileTypes: true })) {
      const p = d ? `${d}/${e.name}` : e.name;
      if (!gone.has(p)) (e.isDirectory() ? out.folders : out.files).add(e.name);
    }
  } catch (e) {
    if (!dirs.has(d)) throw e;
  }
  for (const p of [...mem.keys(), ...dirs]) {
    if (!under(p, d)) continue;
    const rest = d ? p.slice(d.length + 1) : p;
    if (!rest) continue;
    const [first, ...more] = rest.split('/');
    (more.length || (dirs.has(p) && !mem.has(p)) ? out.folders : out.files).add(first);
  }
  return { files: [...out.files], folders: [...out.folders] };
}

function stat(p) {
  if (mem.has(p)) return { type: 'file', size: mem.get(p).length, mtime: Date.now(), ctime: 0 };
  if (gone.has(p)) return null;
  if (dirs.has(p)) return { type: 'folder', size: 0, mtime: 0, ctime: 0 };
  try {
    const s = fs.statSync(real(p));
    return { type: s.isDirectory() ? 'folder' : 'file', size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs };
  } catch (e) {
    return null;
  }
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = (u.searchParams.get('p') || '').replace(/^\/+/, '');
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      if (u.pathname === '/') return send(200, fs.readFileSync(page), 'text/html; charset=utf-8');
      const op = u.pathname.replace('/api/', '');
      if (op === 'list') return send(200, list(p));
      if (op === 'stat') {
        const s = stat(p);
        return s ? send(200, s) : send(404, 'no');
      }
      if (op === 'mkdir') return dirs.add(p), send(200, {});
      if (op === 'rmdir') {
        for (const k of [...mem.keys()]) if (k === p || under(k, p)) mem.delete(k);
        gone.add(p);
        return send(200, {});
      }
      if (op === 'file' && req.method === 'GET') {
        if (mem.has(p)) return send(200, mem.get(p), 'application/octet-stream');
        if (gone.has(p)) return send(404, 'no');
        return send(200, fs.readFileSync(real(p)), 'application/octet-stream');
      }
      if (op === 'file' && req.method === 'PUT') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          mem.set(p, Buffer.concat(chunks));
          gone.delete(p);
          send(200, {});
        });
        return;
      }
      if (op === 'file' && req.method === 'DELETE') return mem.delete(p), gone.add(p), send(200, {});
      send(404, 'no');
    } catch (e) {
      send(e.code === 'ENOENT' ? 404 : 500, e.message, 'text/plain');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Lampada web (prova): http://localhost:${port}/?server=http://localhost:${port}/api`));

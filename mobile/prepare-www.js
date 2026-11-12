// Sukuria www/ iš ../public/driver.html ir įrašo serverio adresą (SERVER_URL)
const fs = require('fs'), path = require('path');
const url = (process.env.SERVER_URL || '').replace(/\/$/, '');
if (!url.startsWith('https://')) { console.error('Nurodykite SERVER_URL=https://jusu-domenas.lt'); process.exit(1); }
const out = path.join(__dirname, 'www'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
fs.copyFileSync(path.join(__dirname, '../public/driver.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(__dirname, '../public/manifest.json'), path.join(out, 'manifest.json'));
fs.writeFileSync(path.join(out, 'config.js'), `window.FLOTAS_SERVER=${JSON.stringify(url)};\n`);
console.log('www paruoštas, serveris:', url);

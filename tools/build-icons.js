// Génère vendor/lucide/icons.js avec uniquement les icônes Lucide utilisées par l'appli.
// Usage : node tools/build-icons.js <dossier icons de lucide-static>
// (npm pack lucide-static, puis décompresser : le dossier est package/icons)
const fs = require('fs'), path = require('path');

const NAMES = [
  'grip-vertical', 'maximize', 'minimize', 'monitor-play', 'pencil-ruler', 'grid-3x3',
  'play', 'pause', 'skip-back', 'plus', 'camera', 'trash-2', 'chevron-up', 'chevron-down',
  'eye', 'eye-off', 'lock', 'lock-open', 'file-video-camera', 'image-plus', 'rotate-ccw',
  'rotate-cw', 'zoom-in', 'zoom-out', 'undo-2', 'volume-2', 'volume-x', 'repeat', 'keyboard',
  'x', 'layers', 'circle-alert', 'radio', 'save', 'folder-open', 'link',
];

const dir = process.argv[2];
if (!dir) { console.error('Usage : node tools/build-icons.js <dossier icons>'); process.exit(1); }
const out = {};
for (const n of NAMES) {
  const svg = fs.readFileSync(path.join(dir, n + '.svg'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*class="[^"]*"/, '')
    .replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  out[n] = svg;
}
const target = path.join(__dirname, '..', 'vendor', 'lucide', 'icons.js');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, '// Icônes Lucide (ISC) - généré par tools/build-icons.js, ne pas modifier à la main.\n' +
  'window.LUCIDE = ' + JSON.stringify(out, null, 0) + ';\n');
console.log(NAMES.length + ' icônes écrites dans ' + target);

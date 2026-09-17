const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(__dirname, 'assets', 'icon.svg'));

async function render(size, outFile) {
  await sharp(svg)
    .resize(size, size)
    .flatten({ background: '#007A5E' })
    .png()
    .toFile(outFile);
}

async function generateAndroid() {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(sizes)) {
    const dir = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
    await render(size, path.join(dir, 'ic_launcher.png'));
    await render(size, path.join(dir, 'ic_launcher_round.png'));
  }
  console.log('Android icons generated.');
}

const IOS_ENTRIES = [
  ['20x20@2x', 40],
  ['20x20@3x', 60],
  ['29x29@2x', 58],
  ['29x29@3x', 87],
  ['40x40@2x', 80],
  ['40x40@3x', 120],
  ['60x60@2x', 120],
  ['60x60@3x', 180],
  ['1024x1024@1x', 1024],
];

async function generateIos() {
  const dir = path.join(ROOT, 'ios', 'Kazi', 'Images.xcassets', 'AppIcon.appiconset');
  const images = [];
  for (const [name, size] of IOS_ENTRIES) {
    const file = `app-icon-${name}.png`;
    await render(size, path.join(dir, file));
    images.push({
      filename: file,
      idiom: name.startsWith('1024') ? 'ios-marketing' : 'iphone',
      scale: name.endsWith('@2x') ? '2x' : name.endsWith('@3x') ? '3x' : '1x',
      size: name.split('@')[0].replace('x', 'x'),
    });
  }
  const contents = {
    images,
    info: { author: 'xcode', version: 1 },
  };
  fs.writeFileSync(path.join(dir, 'Contents.json'), JSON.stringify(contents, null, 2));
  console.log('iOS icons generated.');
}

async function main() {
  await generateAndroid();
  await generateIos();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
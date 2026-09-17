import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { bannerHeight, bannerWidth } from "../../emails/theme";

// Emails cannot crop, so every editorial image also ships as a banner of one shape.
// Run `npm run images:banners` after adding an image; a test fails if a banner is missing.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDirectory = resolve(projectRoot, "public");
const bannerDirectory = resolve(publicDirectory, "images/editorial/banners");

const images = JSON.parse(readFileSync(resolve(projectRoot, "src/data/editorial-images.json"), "utf8")) as { id: string; src: string }[];
mkdirSync(bannerDirectory, { recursive: true });

// A wide photo is cropped to the banner, keeping the subject in frame. A square or upright one would lose
// its subject to that crop (an ear tag became a close-up of two digits), so it sits at full height over a
// blurred copy of itself: the banner keeps one shape and the photo stays whole.
async function banner(source: string) {
  const image = sharp(source);
  const { width = 0, height = 0 } = await image.metadata();
  if (width / height >= 1.5) {
    return image.resize(bannerWidth, bannerHeight, { fit: "cover", position: sharp.strategy.attention }).webp({ quality: 72 }).toBuffer();
  }
  const backdrop = await sharp(source).resize(bannerWidth, bannerHeight, { fit: "cover" }).blur(22).modulate({ brightness: 0.82 }).toBuffer();
  const subject = await sharp(source).resize({ height: bannerHeight, fit: "inside" }).toBuffer();
  return sharp(backdrop).composite([{ input: subject, gravity: "centre" }]).webp({ quality: 72 }).toBuffer();
}

let written = 0;
for (const image of images) {
  const source = resolve(publicDirectory, image.src.replace(/^\//, ""));
  const target = resolve(bannerDirectory, `${image.id}.webp`);
  const current = statSync(target, { throwIfNoEntry: false });
  if (current && current.mtimeMs >= statSync(source).mtimeMs) continue;
  writeFileSync(target, await banner(source));
  written += 1;
}
console.log(`Editorial banners up to date (${written} rebuilt, ${images.length} total).`);

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../screenshots");

const FPS = process.argv.includes("--fast") ? 4 : 2;
const SCALE = process.argv.includes("--half") ? 800 : 1600;

const frames = fs
  .readdirSync(SCREENSHOTS_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

if (frames.length < 2) {
  console.error(`need at least 2 frames, found ${frames.length}`);
  process.exit(1);
}

console.log(`${frames.length} frames → GIF (${SCALE}w, ${FPS}fps)`);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(SCREENSHOTS_DIR, `market-${ts}.gif`);
const palettePath = path.join(SCREENSHOTS_DIR, "_palette.png");
const inputPattern = path.join(SCREENSHOTS_DIR, "market-*.png");

const paletteCmd = [
  "ffmpeg -y",
  `-framerate ${FPS}`,
  `-pattern_type glob -i '${inputPattern}'`,
  `-vf "scale=${SCALE}:-1:flags=lanczos,palettegen=stats_mode=diff"`,
  palettePath,
].join(" ");

const gifCmd = [
  "ffmpeg -y",
  `-framerate ${FPS}`,
  `-pattern_type glob -i '${inputPattern}'`,
  `-i ${palettePath}`,
  `-lavfi "scale=${SCALE}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5"`,
  output,
].join(" ");

try {
  console.log("pass 1: generating palette...");
  execSync(paletteCmd, { stdio: "pipe" });

  console.log("pass 2: encoding gif...");
  execSync(gifCmd, { stdio: "pipe" });

  fs.unlinkSync(palettePath);

  const size = (fs.statSync(output).size / 1024 / 1024).toFixed(1);
  console.log(`saved → ${output} (${size}MB)`);
} catch (err: any) {
  console.error("ffmpeg failed:", err.stderr?.toString() || err.message);
  process.exit(1);
}

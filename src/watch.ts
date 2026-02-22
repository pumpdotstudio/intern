import { launch } from "./browser.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../screenshots");

const URL = process.env.TARGET_URL || process.argv[2] || "https://pump.studio/market";
const INTERVAL_MS = Number(process.env.INTERVAL_MS) || Number(process.env.INTERVAL_S || 0) * 1000 || 30_000;
const DURATION_MS = Number(process.env.DURATION_MS) || Number(process.env.DURATION_M || 0) * 60_000 || 0; // 0 = infinite
const WIDTH = 1600;
const HEIGHT = 929;

async function watch() {
  const browser = await launch(WIDTH, HEIGHT);
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  console.log(`navigating → ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 3000));

  let count = 0;

  const capture = async () => {
    count++;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(SCREENSHOTS_DIR, `market-${ts}.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(`[${count}] ${file}`);
  };

  await capture();

  const timer = setInterval(capture, INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(timer);
    if (stopTimer) clearTimeout(stopTimer);
    await browser.close();
    console.log(`\ndone — ${count} frames in ${SCREENSHOTS_DIR}`);
    process.exit(0);
  };

  // auto-stop after duration (if set)
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  if (DURATION_MS > 0) {
    const mins = Math.round(DURATION_MS / 60_000);
    console.log(`will stop after ${mins}m`);
    stopTimer = setTimeout(shutdown, DURATION_MS);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const interval = INTERVAL_MS / 1000;
  const expected = DURATION_MS > 0 ? Math.floor(DURATION_MS / INTERVAL_MS) + 1 : "∞";
  console.log(`capturing every ${interval}s — expected frames: ${expected}`);
}

watch().catch((err) => {
  console.error(err);
  process.exit(1);
});

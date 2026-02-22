import { launch } from "./browser.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../screenshots");

const URL = process.argv[2] || "https://pump.studio/market";
const WIDTH = 1600;
const HEIGHT = 929;

async function snap() {
  const browser = await launch(WIDTH, HEIGHT);
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  console.log(`navigating → ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 3000));

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(SCREENSHOTS_DIR, `market-${ts}.png`);

  await page.screenshot({ path: file, type: "png" });
  console.log(`saved → ${file}`);

  await browser.close();
}

snap().catch((err) => {
  console.error(err);
  process.exit(1);
});

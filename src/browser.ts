import puppeteer, { type Browser } from "puppeteer";
import fs from "node:fs";

const SYSTEM_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launch(width: number, height: number): Promise<Browser> {
  const useSystem = fs.existsSync(SYSTEM_CHROME);

  return puppeteer.launch({
    headless: true,
    executablePath: useSystem ? SYSTEM_CHROME : undefined,
    args: [
      `--window-size=${width},${height}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

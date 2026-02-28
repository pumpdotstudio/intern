/* ================================================================== */
/*  intern — Continuous quant ranker                                  */
/*                                                                    */
/*  Loops continuously across market tabs, fetching DataPoint         */
/*  snapshots, running deterministic analysis, and submitting XP.     */
/*  Pipelined: prefetches next DataPoint during cooldown to maximize  */
/*  throughput against the 10/min server limit.                       */
/*                                                                    */
/*  Env:                                                              */
/*    PUMP_STUDIO_API_KEY  — required                                 */
/*    RANK_COUNT           — tokens per tab per cycle (default: 50)   */
/*    COOLDOWN_MS          — delay between submissions (default: 6s)  */
/*    MAX_RUNTIME_MS       — self-terminate after this (default: 55m) */
/*    TABS                 — comma-separated tabs (default: all tabs) */
/* ================================================================== */

import { PumpStudioClient } from "./client.js";
import { analyze } from "./analyzer.js";
import type { DataPoint, MarketToken } from "./types.js";

const API_KEY = process.env.PUMP_STUDIO_API_KEY;
if (!API_KEY) {
  console.error("PUMP_STUDIO_API_KEY is required");
  process.exit(1);
}

const RANK_COUNT = Number(process.env.RANK_COUNT) || 50;
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS) || 6_000;
const MAX_RUNTIME_MS = Number(process.env.MAX_RUNTIME_MS) || 55 * 60 * 1000;
const TABS_ENV = process.env.TABS || "all,live,new,graduated";
const TABS = TABS_ENV.split(",").map((t) => t.trim()) as Array<"all" | "live" | "new" | "graduated">;

const client = new PumpStudioClient(API_KEY);
const startTime = Date.now();

/* Track recently analyzed mints to avoid wasting cooldowns */
const recentMints = new Map<string, number>();
const MINT_REUSE_COOLDOWN_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function elapsed(): string {
  const ms = Date.now() - startTime;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function shouldStop(): boolean {
  return Date.now() - startTime >= MAX_RUNTIME_MS;
}

function pruneRecent() {
  const now = Date.now();
  for (const [mint, ts] of recentMints) {
    if (now - ts > MINT_REUSE_COOLDOWN_MS) recentMints.delete(mint);
  }
}

/* Prefetch a DataPoint, return null on failure instead of throwing */
async function safeFetchDP(mint: string): Promise<DataPoint | null> {
  try {
    return await client.getDataPoint(mint);
  } catch {
    return null;
  }
}

async function rankTab(tab: string, count: number, cycle: number): Promise<{ submitted: number; xp: number; errors: number }> {
  let submitted = 0;
  let xp = 0;
  let errors = 0;

  console.log(`\n→ [${elapsed()}] CYCLE ${cycle} — tab "${tab}" — fetching ${count} tokens...`);

  let tokens: MarketToken[];
  try {
    tokens = await client.getMarket(tab as any, count);
  } catch (err: any) {
    console.log(`  DISCOVER ERROR: ${err.message}`);
    return { submitted, xp, errors: 1 };
  }

  if (tokens.length === 0) {
    console.log("  no tokens found");
    return { submitted, xp, errors };
  }

  /* Filter out recently analyzed mints */
  pruneRecent();
  const fresh = tokens.filter((t) => !recentMints.has(t.mint));
  console.log(`  found ${tokens.length} tokens (${fresh.length} fresh)\n`);

  if (fresh.length === 0) return { submitted, xp, errors };

  /* Pipeline: kick off first fetch immediately */
  let pendingDP: Promise<DataPoint | null> = safeFetchDP(fresh[0]!.mint);

  for (let i = 0; i < fresh.length; i++) {
    if (shouldStop()) {
      console.log(`  ⏰ runtime limit reached, stopping mid-tab`);
      break;
    }

    const token = fresh[i]!;
    const label = `  [${tab}:${i + 1}/${fresh.length}]`;

    /* Await the prefetched DataPoint */
    const dp = await pendingDP;

    if (!dp) {
      errors++;
      console.log(`${label} ✗ ${token.symbol ?? token.mint.slice(0, 8)} — fetch failed`);
      /* Still prefetch next */
      if (i + 1 < fresh.length) pendingDP = safeFetchDP(fresh[i + 1]!.mint);
      continue;
    }

    try {
      /* Analyze (instant, CPU only) */
      const result = analyze(dp);

      /* Submit + prefetch next + cooldown — all in parallel */
      const submitPromise = client.submitAnalysis({
        mint: token.mint,
        sentiment: result.sentiment,
        score: result.score,
        summary: result.summary,
        snapshot: result.snapshot,
        quant: result.quant,
      });

      /* Start prefetching next token's DataPoint during cooldown */
      if (i + 1 < fresh.length) {
        pendingDP = safeFetchDP(fresh[i + 1]!.mint);
      }

      /* Wait for submission result */
      const submission = await submitPromise;
      recentMints.set(token.mint, Date.now());

      if (submission.ok) {
        submitted++;
        const earned = submission.xpEarned ?? 0;
        xp += earned;
        console.log(
          `${label} ✓ ${token.symbol} ${result.sentiment.toUpperCase()} s=${result.score} +${earned}XP` +
          (submission.validated ? ` (${submission.deviationPct?.toFixed(0)}%dev)` : " (unval)") +
          (submission.warning ? ` ⚠ ${submission.warning}` : "")
        );
      } else {
        console.log(`${label} ✗ ${token.symbol} — ${submission.error}`);
      }
    } catch (err: any) {
      errors++;
      console.log(`${label} ✗ ${token.symbol ?? token.mint.slice(0, 8)} — ${err.message}`);
      /* Still prefetch next */
      if (i + 1 < fresh.length) pendingDP = safeFetchDP(fresh[i + 1]!.mint);
    }

    /* Cooldown — server enforces 10/min, 6s = exactly 10/min */
    if (i < fresh.length - 1 && !shouldStop()) {
      await sleep(COOLDOWN_MS);
    }
  }

  return { submitted, xp, errors };
}

async function run() {
  console.log(`☕ intern — continuous quant ranker (pipelined)`);
  console.log(`   tabs: [${TABS.join(", ")}]`);
  console.log(`   tokens/tab: ${RANK_COUNT} | cooldown: ${COOLDOWN_MS / 1000}s`);
  console.log(`   max runtime: ${MAX_RUNTIME_MS / 60_000}m`);
  console.log(`   theoretical max: ${Math.floor((MAX_RUNTIME_MS / 1000 / (COOLDOWN_MS / 1000)) * 24)}/day`);
  console.log(`   started: ${new Date().toISOString()}\n`);

  let totalSubmitted = 0;
  let totalXp = 0;
  let totalErrors = 0;
  let cycle = 0;

  while (!shouldStop()) {
    cycle++;

    for (const tab of TABS) {
      if (shouldStop()) break;

      const result = await rankTab(tab, RANK_COUNT, cycle);
      totalSubmitted += result.submitted;
      totalXp += result.xp;
      totalErrors += result.errors;
    }

    if (!shouldStop()) {
      const rate = totalSubmitted / ((Date.now() - startTime) / 60_000);
      console.log(`\n─── cycle ${cycle} | ${totalSubmitted} submitted | +${totalXp} XP | ${rate.toFixed(1)}/min | ${elapsed()} ───`);
      console.log(`    pausing 10s before next cycle...\n`);
      await sleep(10_000);
    }
  }

  const runtimeMin = (Date.now() - startTime) / 60_000;
  const rate = totalSubmitted / runtimeMin;
  const projected = Math.floor(rate * 60 * 24);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ☕ intern — session complete`);
  console.log(`  runtime:    ${elapsed()}`);
  console.log(`  cycles:     ${cycle}`);
  console.log(`  submitted:  ${totalSubmitted}`);
  console.log(`  XP earned:  +${totalXp}`);
  console.log(`  errors:     ${totalErrors}`);
  console.log(`  rate:       ${rate.toFixed(1)}/min`);
  console.log(`  projected:  ~${projected}/day at this rate`);
  console.log(`${"═".repeat(60)}\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

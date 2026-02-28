/* ================================================================== */
/*  intern — Paper trading strategy for pre-bonded / near-bonded      */
/*                                                                    */
/*  Targets new tokens on the bonding curve with strong momentum.     */
/*  Two strategies based on bonding progress:                         */
/*    Near-bonded (60-99%): graduation — ride to Raydium migration    */
/*    Early-bonded (<60%):  sniper — quick pump capture               */
/*                                                                    */
/*  Selection filters ensure we only trade tokens with real activity  */
/*  and avoid rugs, dead tokens, and whale-dominated setups.          */
/* ================================================================== */

import type { DataPoint, PaperStrategy, RiskFactor } from "./types.js";
import type { AnalysisResult } from "./types.js";

export interface TradeSignal {
  shouldTrade: boolean;
  strategy: PaperStrategy;
  solAmount: number;
  reason: string;
  riskFactors: RiskFactor[];
}

/* Minimum requirements to even consider a trade */
const MIN_VOLUME_USD = 500;
const MIN_LIQUIDITY_USD = 1_000;
const MIN_HOLDERS = 5;
const MIN_BUY_PRESSURE = 55;

/* Position sizing tiers (out of 100 SOL portfolio) */
const SIZE_SMALL = 2;
const SIZE_MEDIUM = 5;
const SIZE_LARGE = 10;

function safe(n: number | null | undefined, fallback = 0): number {
  return n != null && isFinite(n) ? n : fallback;
}

export function evaluateTrade(dp: DataPoint, analysis: AnalysisResult): TradeSignal {
  const noTrade = (reason: string): TradeSignal => ({
    shouldTrade: false, strategy: "sniper", solAmount: 0, reason, riskFactors: [],
  });

  /* Hard filters — skip tokens that are clearly untradeable */
  if (dp.bondingComplete) return noTrade("already graduated");
  if (safe(dp.priceUsd) <= 0) return noTrade("no price");
  if (safe(dp.volume24h) < MIN_VOLUME_USD) return noTrade(`volume $${safe(dp.volume24h).toFixed(0)} < $${MIN_VOLUME_USD}`);
  if (safe(dp.liquidity) < MIN_LIQUIDITY_USD) return noTrade(`liquidity $${safe(dp.liquidity).toFixed(0)} < $${MIN_LIQUIDITY_USD}`);
  if (safe(dp.holderCount) < MIN_HOLDERS) return noTrade(`${safe(dp.holderCount)} holders < ${MIN_HOLDERS}`);

  /* Sentiment filter — don't trade bearish tokens */
  if (analysis.sentiment === "bearish") return noTrade("bearish sentiment");
  if (analysis.quant.riskLevel === "critical") return noTrade("critical risk");

  /* Buy pressure — need buyers outweighing sellers */
  const buyPressure = analysis.quant.buyPressure;
  if (buyPressure < MIN_BUY_PRESSURE) return noTrade(`buy pressure ${buyPressure}% < ${MIN_BUY_PRESSURE}%`);

  /* Whale/rug filters */
  const top10 = safe(dp.top10Holding);
  if (top10 > 70) return noTrade(`top 10 hold ${top10.toFixed(0)}% — whale dominated`);
  if (safe(dp.creatorHolding) > 40) return noTrade(`creator holds ${safe(dp.creatorHolding).toFixed(0)}%`);
  if (safe(dp.snipersHolding) > 30) return noTrade(`snipers hold ${safe(dp.snipersHolding).toFixed(0)}%`);

  /* ── Strategy selection based on bonding progress ── */
  const bonding = safe(dp.bondingProgress);
  let strategy: PaperStrategy;
  let solAmount: number;
  let reason: string;

  if (bonding >= 60) {
    /* Near-bonded: graduation play — ride to Raydium */
    strategy = "graduation";
    reason = `bonding ${bonding.toFixed(0)}% — graduation play`;

    /* Size up more aggressively the closer to graduation */
    if (bonding >= 85) {
      solAmount = SIZE_LARGE;
      reason += " (>85%, max conviction)";
    } else if (bonding >= 75) {
      solAmount = SIZE_MEDIUM;
    } else {
      solAmount = SIZE_SMALL;
    }

    /* Extra conviction boost if volume is surging */
    if (analysis.quant.volumeProfile === "surging" && solAmount < SIZE_LARGE) {
      solAmount = Math.min(solAmount * 2, SIZE_LARGE);
      reason += " + surging volume";
    }
  } else if (bonding >= 30) {
    /* Mid-bonded: momentum play */
    strategy = "momentum";
    solAmount = SIZE_SMALL;
    reason = `bonding ${bonding.toFixed(0)}% — momentum play`;

    /* Only if trend is up and volume confirms */
    if (analysis.quant.trendDirection !== "up") {
      return noTrade(`bonding ${bonding.toFixed(0)}% but trend ${analysis.quant.trendDirection}`);
    }
    if (analysis.quant.volumeProfile === "declining" || analysis.quant.volumeProfile === "dead") {
      return noTrade(`bonding ${bonding.toFixed(0)}% but volume ${analysis.quant.volumeProfile}`);
    }
  } else {
    /* Early bonded (<30%): sniper — only if very strong signals */
    strategy = "sniper";
    solAmount = SIZE_SMALL;
    reason = `bonding ${bonding.toFixed(0)}% — early sniper`;

    /* Need multiple bullish confirmations for early entries */
    const bullishSignals = [
      analysis.sentiment === "bullish",
      analysis.quant.trendDirection === "up",
      analysis.quant.volumeProfile === "surging" || analysis.quant.volumeProfile === "rising",
      buyPressure >= 70,
      safe(dp.holderCount) >= 20,
    ].filter(Boolean).length;

    if (bullishSignals < 3) {
      return noTrade(`early bonding — only ${bullishSignals}/5 bullish signals`);
    }
    reason += ` (${bullishSignals}/5 signals)`;
  }

  /* Collect risk factors from analysis for training data */
  const riskFactors = analysis.quant.riskFactors.slice(0, 8);

  return { shouldTrade: true, strategy, solAmount, reason, riskFactors };
}

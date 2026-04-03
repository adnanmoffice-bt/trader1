/**
 * APEX Weekend Trading Simulation
 * Simulates Fri-Sun trading with AED 5,000 using real Binance data
 * Uses last 72h of 1h candles to replay weekend price action
 */

const CAPITAL_AED = 5000;
const USD_AED = 3.6725;
const CAPITAL_USD = CAPITAL_AED / USD_AED;
const MAX_RISK = 0.05;
const MIN_RR = 1.5;
const SLIP = 0.0005;
const BINANCE = 'https://api.binance.com/api/v3';

const INSTRUMENTS = [
  { sym: 'BTCUSDT', name: 'BTC/USD' },
  { sym: 'ETHUSDT', name: 'ETH/USD' },
  { sym: 'SOLUSDT', name: 'SOL/USD' },
];

function ema(prices, period) {
  const k = 2 / (period + 1);
  const r = [prices[0]];
  for (let i = 1; i < prices.length; i++) r.push(prices[i] * k + r[i-1] * (1-k));
  return r;
}

function rsi(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  let ag = gains.slice(0, period).reduce((a,b) => a+b, 0) / period;
  let al = losses.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < changes.length; i++) {
    ag = (ag * (period-1) + gains[i]) / period;
    al = (al * (period-1) + losses[i]) / period;
  }
  if (al === 0) return 100;
  return Math.round((100 - 100 / (1 + ag/al)) * 100) / 100;
}

function bollinger(prices, period = 20) {
  const s = prices.slice(-period);
  const mid = s.reduce((a,b) => a+b, 0) / period;
  const sd = Math.sqrt(s.reduce((sum, v) => sum + (v-mid)**2, 0) / period);
  return { upper: mid + 2*sd, mid, lower: mid - 2*sd };
}

function getSignal(closes, price) {
  if (closes.length < 55) return null;
  const r = rsi(closes.slice(-50));
  const e20 = ema(closes, 20).at(-1);
  const e50 = ema(closes, 50).at(-1);
  const bb = bollinger(closes);
  let bull = 0, bear = 0;

  if (r < 30) bull += 25; else if (r < 45) bull += 12;
  else if (r > 70) bear += 25; else if (r > 55) bear += 12;

  if (price > e20 && e20 > e50) bull += 20;
  else if (price < e20 && e20 < e50) bear += 20;

  const pctB = bb.upper !== bb.lower ? (price - bb.lower) / (bb.upper - bb.lower) : 0.5;
  if (pctB < 0.2) bull += 15; else if (pctB > 0.8) bear += 15;

  const total = bull + bear;
  const conf = total > 0 ? Math.round(Math.max(bull, bear) / total * 100) : 50;
  if (conf < 60) return null;

  const dir = bull > bear ? 'long' : 'short';
  const atr = closes.slice(-14).reduce((s, c, i, a) => i > 0 ? s + Math.abs(c - a[i-1]) : s, 0) / 14;
  const entry = price * (dir === 'long' ? 1 + SLIP : 1 - SLIP);
  const sl = dir === 'long' ? entry - atr * 1.5 : entry + atr * 1.5;
  const tp = dir === 'long' ? entry + atr * 1.5 * MIN_RR : entry - atr * 1.5 * MIN_RR;
  const rr = Math.abs(tp - entry) / Math.abs(sl - entry);
  if (rr < MIN_RR) return null;

  return { dir, entry: Math.round(entry*100)/100, sl: Math.round(sl*100)/100, tp: Math.round(tp*100)/100, conf, rr: Math.round(rr*100)/100, rsi: Math.round(r), atr: Math.round(atr*100)/100 };
}

async function fetchKlines(symbol, limit = 200) {
  const res = await fetch(`${BINANCE}/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
  return (await res.json()).map(k => ({
    time: new Date(k[0]).toISOString(),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5]
  }));
}

async function run() {
  console.log('\n' + '='.repeat(65));
  console.log('  APEX WEEKEND SIMULATION');
  console.log(`  Capital: AED ${CAPITAL_AED.toLocaleString()} ($${CAPITAL_USD.toFixed(0)} USD)`);
  console.log(`  Period: Last 72 hours (simulating Fri-Sun)`);
  console.log(`  Instruments: ${INSTRUMENTS.map(i => i.name).join(', ')}`);
  console.log('='.repeat(65) + '\n');

  let capital = CAPITAL_USD;
  const allTrades = [];
  let peak = capital;
  let maxDD = 0;

  for (const inst of INSTRUMENTS) {
    console.log(`[${inst.name}] Fetching 200 candles...`);
    const candles = await fetchKlines(inst.sym);
    if (candles.length < 100) { console.log('  Not enough data'); continue; }

    const weekendCandles = candles.slice(-72);
    const historyCandles = candles.slice(0, -72);
    const allCloses = historyCandles.map(c => c.close);
    let positions = [];
    let cooldown = 0;

    console.log(`  ${weekendCandles.length} weekend candles, ${historyCandles.length} history candles`);
    console.log(`  Start: $${weekendCandles[0].close.toLocaleString()} | End: $${weekendCandles.at(-1).close.toLocaleString()}`);
    console.log('');

    for (let i = 0; i < weekendCandles.length; i++) {
      const c = weekendCandles[i];
      allCloses.push(c.close);

      for (const p of [...positions]) {
        let hit = null;
        if (p.dir === 'long') {
          if (c.low <= p.sl) hit = { price: p.sl, reason: 'stop_loss' };
          else if (c.high >= p.tp) hit = { price: p.tp, reason: 'take_profit' };
        } else {
          if (c.high >= p.sl) hit = { price: p.sl, reason: 'stop_loss' };
          else if (c.low <= p.tp) hit = { price: p.tp, reason: 'take_profit' };
        }
        if (hit) {
          const pnl = p.dir === 'long'
            ? (hit.price - p.entry) * p.qty * (1 - SLIP)
            : (p.entry - hit.price) * p.qty * (1 - SLIP);
          capital += pnl;
          const pnlAed = pnl * USD_AED;
          const icon = hit.reason === 'take_profit' ? 'TP' : 'SL';
          const emoji = pnl > 0 ? '+' : '';
          console.log(`  ${icon} ${inst.name} ${p.dir.toUpperCase().padEnd(5)} | Exit $${hit.price.toLocaleString(undefined,{minimumFractionDigits:2})} | P&L: ${emoji}AED ${(pnlAed).toFixed(0)} (${emoji}${(pnl/p.entry/p.qty*100).toFixed(2)}%) | ${c.time.slice(5,16)}`);
          allTrades.push({ inst: inst.name, dir: p.dir, entry: p.entry, exit: hit.price, pnl, pnlAed, reason: hit.reason });
          positions = positions.filter(x => x !== p);
          const dd = (peak - capital) / peak;
          if (dd > maxDD) maxDD = dd;
          if (capital > peak) peak = capital;
        }
      }

      cooldown = Math.max(0, cooldown - 1);
      const hasOpen = positions.some(p => p.inst === inst.name);
      if (!hasOpen && cooldown === 0 && i % 4 === 0) {
        const sig = getSignal(allCloses, c.close);
        if (sig) {
          const riskUsd = capital * MAX_RISK;
          const riskPerUnit = Math.abs(sig.entry - sig.sl);
          if (riskPerUnit > 0) {
            const qty = riskUsd / riskPerUnit;
            positions.push({ inst: inst.name, dir: sig.dir, entry: sig.entry, sl: sig.sl, tp: sig.tp, qty, conf: sig.conf });
            cooldown = 8;
            console.log(`  >> ${inst.name} ${sig.dir.toUpperCase().padEnd(5)} @ $${sig.entry.toLocaleString(undefined,{minimumFractionDigits:2})} | SL:$${sig.sl.toFixed(2)} TP:$${sig.tp.toFixed(2)} | Conf:${sig.conf}% R:R:${sig.rr} RSI:${sig.rsi} | ${c.time.slice(5,16)}`);
          }
        }
      }
    }

    for (const p of positions) {
      const lastPrice = weekendCandles.at(-1).close;
      const pnl = p.dir === 'long'
        ? (lastPrice - p.entry) * p.qty * (1 - SLIP)
        : (p.entry - lastPrice) * p.qty * (1 - SLIP);
      capital += pnl;
      allTrades.push({ inst: inst.name, dir: p.dir, entry: p.entry, exit: lastPrice, pnl, pnlAed: pnl * USD_AED, reason: 'weekend_end' });
      console.log(`  -- ${inst.name} ${p.dir.toUpperCase().padEnd(5)} | Close @ $${lastPrice.toLocaleString(undefined,{minimumFractionDigits:2})} | P&L: ${pnl>0?'+':''}AED ${(pnl*USD_AED).toFixed(0)} (still open)`);
    }
    console.log('');
  }

  const wins = allTrades.filter(t => t.pnl > 0);
  const losses = allTrades.filter(t => t.pnl <= 0);
  const totalPnlUsd = capital - CAPITAL_USD;
  const totalPnlAed = totalPnlUsd * USD_AED;
  const wr = allTrades.length > 0 ? (wins.length / allTrades.length * 100) : 0;

  console.log('='.repeat(65));
  console.log('  WEEKEND SIMULATION RESULTS');
  console.log('='.repeat(65));
  console.log(`  Starting Capital:  AED ${CAPITAL_AED.toLocaleString().padStart(10)}  ($${CAPITAL_USD.toFixed(0)})`);
  console.log(`  Final Capital:     AED ${(capital * USD_AED).toFixed(0).padStart(10)}  ($${capital.toFixed(0)})`);
  console.log(`  Total P&L:         AED ${(totalPnlAed >= 0 ? '+' : '') + totalPnlAed.toFixed(0).padStart(9)}  (${(totalPnlAed >= 0 ? '+' : '')}${(totalPnlUsd/CAPITAL_USD*100).toFixed(2)}%)`);
  console.log(`  Trades:            ${allTrades.length.toString().padStart(10)}  (${wins.length}W / ${losses.length}L)`);
  console.log(`  Win Rate:          ${wr.toFixed(1).padStart(9)}%`);
  console.log(`  Max Drawdown:      ${(maxDD * 100).toFixed(2).padStart(9)}%`);
  console.log(`  Avg Win:           AED ${wins.length > 0 ? (wins.reduce((s,t) => s + t.pnlAed, 0) / wins.length).toFixed(0) : '0'}`);
  console.log(`  Avg Loss:          AED ${losses.length > 0 ? (losses.reduce((s,t) => s + t.pnlAed, 0) / losses.length).toFixed(0) : '0'}`);
  console.log('='.repeat(65));

  console.log('\n  Trade Log:');
  allTrades.forEach((t, i) => {
    const icon = t.pnl > 0 ? 'W' : 'L';
    console.log(`  ${(i+1).toString().padStart(2)}. [${icon}] ${t.inst.padEnd(8)} ${t.dir.toUpperCase().padEnd(5)} $${t.entry.toFixed(2)} -> $${t.exit.toFixed(2)} | ${t.pnl > 0 ? '+' : ''}AED ${t.pnlAed.toFixed(0)} | ${t.reason}`);
  });
  console.log('');
}

run().catch(e => { console.error(e); process.exit(1); });

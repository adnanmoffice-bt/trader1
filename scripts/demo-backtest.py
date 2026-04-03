#!/usr/bin/env python3
"""
APEX 5-Day Demo Backtest — real Binance historical data
Usage: python3 scripts/demo-backtest.py
"""
import os, json, time, uuid, math
from datetime import datetime, timezone
import requests

INITIAL_CAPITAL=200000; USD_AED=3.6725; MAX_RISK=0.05; MIN_RR=1.5; SLIP=0.0005
START="2026-03-29"; END="2026-04-03"
BINANCE="https://api.binance.com/api/v3"
INSTRUMENTS=[{"s":"BTCUSDT","n":"BTC/USD"},{"s":"ETHUSDT","n":"ETH/USD"}]

def ema(p,k): r=[p[0]]; f=2/(k+1); [r.append(p[i]*f+r[-1]*(1-f)) for i in range(1,len(p))]; return r
def rsi(p,k=14):
  if len(p)<k+1: return 50
  c=[p[i]-p[i-1] for i in range(1,len(p))]; g=[max(x,0) for x in c]; l=[abs(min(x,0)) for x in c]
  ag=sum(g[:k])/k; al=sum(l[:k])/k
  for i in range(k,len(c)): ag=(ag*(k-1)+g[i])/k; al=(al*(k-1)+l[i])/k
  return 100 if al==0 else 100-100/(1+ag/al)
def boll(p,k=20,m=2):
  s=p[-k:]; mid=sum(s)/k; sd=math.sqrt(sum((x-mid)**2 for x in s)/k); return mid+m*sd,mid,mid-m*sd

def fetch(sym,interval,start,end):
  sms=int(datetime.strptime(start,"%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()*1000)
  ems=int(datetime.strptime(end,  "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()*1000)
  all_k=[]; cur=sms
  while cur<ems:
    r=requests.get(f"{BINANCE}/klines",params={"symbol":sym,"interval":interval,"startTime":cur,"endTime":ems,"limit":1000},timeout=10)
    d=r.json()
    if not d or not isinstance(d,list): break
    all_k.extend(d); cur=d[-1][6]+1; time.sleep(0.15)
  return all_k

def signal(closes,price):
  if len(closes)<55: return None
  r=rsi(closes[-50:]); e20=ema(closes,20)[-1]; e50=ema(closes,50)[-1]
  bu=boll(closes); bull=bear=0
  if r<30: bull+=25
  elif r<45: bull+=12
  elif r>70: bear+=25
  elif r>55: bear+=12
  if price>e20>e50: bull+=20
  elif price<e20<e50: bear+=20
  pctb=(price-bu[2])/(bu[0]-bu[2]) if bu[0]!=bu[2] else 0.5
  if pctb<0.2: bull+=15
  elif pctb>0.8: bear+=15
  conf=int(max(bull,bear)/(bull+bear+1)*100) if (bull+bear)>0 else 50
  if conf<65: return None
  d="long" if bull>bear else "short"
  atr=sum(abs(closes[i]-closes[i-1]) for i in range(-14,0))/14
  e=price*(1+SLIP if d=="long" else 1-SLIP)
  sl=e-atr*1.5 if d=="long" else e+atr*1.5
  tp=e+atr*1.5*MIN_RR if d=="long" else e-atr*1.5*MIN_RR
  rr=abs(tp-e)/abs(sl-e) if abs(sl-e)>0 else 0
  if rr<MIN_RR: return None
  return {"d":d,"e":round(e,2),"sl":round(sl,2),"tp":round(tp,2),"conf":conf,"rr":round(rr,2)}

class Pos:
  def __init__(self,inst,d,e,sl,tp,qty,conf,reason,ts):
    self.id=str(uuid.uuid4()); self.inst=inst; self.d=d; self.e=e; self.sl=sl; self.tp=tp
    self.qty=qty; self.conf=conf; self.reason=reason; self.et=ts
    self.xt=self.xp=self.xr=self.pnl=None
  def check(self,hi,lo,ts):
    if self.d=="long":
      if lo<=self.sl:   self._close(self.sl,"stop_loss",ts); return True
      if hi>=self.tp:   self._close(self.tp,"take_profit",ts); return True
    else:
      if hi>=self.sl:   self._close(self.sl,"stop_loss",ts); return True
      if lo<=self.tp:   self._close(self.tp,"take_profit",ts); return True
    return False
  def _close(self,p,r,ts):
    self.xp=p; self.xr=r; self.xt=ts
    raw=(p-self.e if self.d=="long" else self.e-p)*self.qty; self.pnl=raw*(1-SLIP)

def run():
  print(f"\n{'='*55}\n  APEX Demo: {START} → {END} | Capital AED {INITIAL_CAPITAL:,}\n{'='*55}\n")
  sid=str(uuid.uuid4()); cap=INITIAL_CAPITAL; trades=[]; eq=[cap]; peak=cap; mdd=0

  for inst in INSTRUMENTS:
    print(f"[{inst['n']}] Fetching data...")
    kl=fetch(inst["s"],"1h",START,END)
    if not kl: print("  ⚠ No data"); continue
    closes=[float(k[4]) for k in kl]; highs=[float(k[2]) for k in kl]; lows=[float(k[3]) for k in kl]
    times=[datetime.fromtimestamp(k[0]/1000,tz=timezone.utc).isoformat() for k in kl]
    positions=[]; cooldown=0
    print(f"  → {len(kl)} candles")
    for i in range(55,len(kl)):
      ts=times[i]; hi=highs[i]; lo=lows[i]; cl=closes[i]
      for p in positions[:]:
        if p.check(hi,lo,ts):
          positions.remove(p); cap+=p.pnl; eq.append(cap)
          dd=(peak-cap)/peak; mdd=max(mdd,dd)
          if cap>peak: peak=cap; trades.append(p)
          icon="✅ TP" if p.xr=="take_profit" else "🛑 SL"
          print(f"  {icon} {inst['n']} {p.d.upper():5} | Exit ${p.xp:,.2f} | P&L AED {p.pnl*USD_AED:+,.0f}")
      open_inst=any(p.inst==inst["n"] for p in positions); cooldown=max(0,cooldown-1)
      if not open_inst and cooldown==0 and i%6==0:
        sig=signal(closes[:i+1],cl)
        if sig:
          risk=cap*MAX_RISK; rpq=abs(sig["e"]-sig["sl"])
          if rpq>0:
            qty=risk/rpq/USD_AED
            positions.append(Pos(inst["n"],sig["d"],sig["e"],sig["sl"],sig["tp"],qty,sig["conf"],f"RSI R:R{sig['rr']}",ts))
            cooldown=12; print(f"  📡 {inst['n']} {sig['d'].upper():5} @ ${sig['e']:,.2f} | Conf:{sig['conf']}% R:R:{sig['rr']}")
    for p in positions:
      p._close(closes[-1],"open",times[-1]); cap+=p.pnl; trades.append(p)

  wins=[t for t in trades if (t.pnl or 0)>0]; losses=[t for t in trades if (t.pnl or 0)<=0]
  pnl=cap-INITIAL_CAPITAL; pnl_aed=pnl*USD_AED; wr=len(wins)/len(trades) if trades else 0
  pnl_pct=(pnl/(INITIAL_CAPITAL/USD_AED))*100
  rets=[(eq[i]-eq[i-1])/eq[i-1] for i in range(1,len(eq))] if len(eq)>2 else [0]
  ar=sum(rets)/len(rets); sr=(ar/max(math.sqrt(sum((r-ar)**2 for r in rets)/len(rets)),1e-9))*math.sqrt(252) if len(rets)>1 else 0

  print(f"\n{'='*55}")
  print(f"  RESULTS: {START} → {END}")
  print(f"  Capital:    AED {INITIAL_CAPITAL:>10,.0f} → AED {cap*USD_AED:>10,.0f}")
  print(f"  Total P&L:  AED {pnl_aed:>+10,.0f}  ({pnl_pct:+.2f}%)")
  print(f"  Trades:     {len(trades)} ({len(wins)}W / {len(losses)}L) | Win:{wr*100:.1f}%")
  print(f"  Max DD:     {mdd*100:.2f}%  |  Sharpe: {sr:.2f}")
  print(f"{'='*55}\n")

  report={"session":{"start":START,"end":END,"initial_aed":INITIAL_CAPITAL,"final_aed":round(cap*USD_AED,2),
    "pnl_aed":round(pnl_aed,2),"pnl_pct":round(pnl_pct,2),"trades":len(trades),
    "win_rate":round(wr,4),"sharpe":round(sr,4),"max_dd":round(mdd,4)},
    "trades":[{"inst":t.inst,"dir":t.d,"entry":t.e,"exit":t.xp,"pnl_aed":round((t.pnl or 0)*USD_AED,2),"reason":t.xr} for t in trades]}
  out=f"demo_{sid[:8]}.json"
  with open(out,"w") as f: json.dump(report,f,indent=2)
  print(f"✅ Report: {out}")

if __name__=="__main__":
  run()

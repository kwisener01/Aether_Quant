
import { Tick, TickLabel, TickWindow } from "../types";

export interface TradierQuote {
  symbol: string;
  last: number;
  change: number;
  change_percentage: number;
  volume: number;
  description: string;
  prevclose?: number;
  open?: number;
}

export interface TradierBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class TradierService {
  private baseUrl: string;
  private token: string;
  private k = 5; 
  private alpha = 1e-5; 

  constructor(token: string, isSandbox: boolean = false) {
    this.token = token;
    this.baseUrl = isSandbox 
      ? 'https://sandbox.tradier.com/v1' 
      : 'https://api.tradier.com/v1';
  }

  public isMarketHours(): boolean {
    const now = new Date();
    const est = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const day = est.getDay();
    const hour = est.getHours();
    const min = est.getMinutes();
    if (day === 0 || day === 6) return false;
    const totalMin = hour * 60 + min;
    return totalMin >= 570 && totalMin <= 960;
  }

  private async fetchTradier(endpoint: string, method: string = 'GET', body?: any) {
    try {
      const options: RequestInit = {
        method,
        headers: { 'Authorization': `Bearer ${this.token}`, 'Accept': 'application/json' }
      };
      if (body) {
        options.body = JSON.stringify(body);
        options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      }
      const response = await fetch(`${this.baseUrl}${endpoint}`, options);
      if (!response.ok) throw new Error(`Tradier API error: ${response.status}`);
      return await response.json();
    } catch (err) {
      throw err;
    }
  }

  async getQuotes(symbols: string[]): Promise<TradierQuote[]> {
    const data = await this.fetchTradier(`/markets/quotes?symbols=${symbols.join(',')}`);
    if (!data.quotes || !data.quotes.quote) return [];
    const quotes = data.quotes.quote;
    return Array.isArray(quotes) ? quotes : [quotes];
  }

  async getIntradayHistory(symbol: string): Promise<TradierBar[]> {
    const start = new Date();
    start.setDate(start.getDate() - 3);
    const startStr = `${start.toISOString().split('T')[0]} 09:30`;
    const data = await this.fetchTradier(`/markets/timesales?symbol=${symbol}&interval=1min&start=${startStr}&session=true`);
    if (!data.series || !data.series.data) return [];
    return Array.isArray(data.series.data) ? data.series.data : [data.series.data];
  }

  async createStreamSession(): Promise<string> {
    const data = await this.fetchTradier('/markets/events/session', 'POST');
    return data.stream.sessionid;
  }

  cleanAndProcessTick(raw: any): Tick | null {
    // We process ticks even if "closed" to allow for simulation/testing, 
    // but the UI will show the warning.
    const bid = parseFloat(raw.bid);
    const ask = parseFloat(raw.ask);
    const last = parseFloat(raw.last);
    if (isNaN(bid) || isNaN(ask) || bid <= 0 || ask <= 0 || bid >= ask) return null;
    const mid = (bid + ask) / 2;
    const spread = ask - bid;
    if (spread > (mid * 0.25)) return null;

    const bidVol = parseInt(raw.bidsize || '0');
    const askVol = parseInt(raw.asksize || '0');

    return {
      time: Date.now(),
      bid, 
      ask, 
      last: last || mid, 
      mid, 
      spread,
      volume: bidVol + askVol,
      bidVolume: bidVol,
      askVolume: askVol
    };
  }

  calculateWindowLabel(currentTicks: Tick[], lastWindowMid: number): TickWindow {
    const meanMid = currentTicks.reduce((acc, t) => acc + t.mid, 0) / currentTicks.length;
    const ratio = meanMid / lastWindowMid;
    
    const first = currentTicks[0];
    const last = currentTicks[currentTicks.length - 1];
    
    const v3 = (last.bid - first.ask) / first.ask;
    const variance = currentTicks.reduce((acc, t) => acc + Math.pow(t.mid - meanMid, 2), 0) / currentTicks.length;
    const v9 = Math.sqrt(variance);
    const v10 = currentTicks.reduce((acc, t) => acc + t.volume, 0);
    const v14_ask_vol = currentTicks.reduce((acc, t) => acc + t.askVolume, 0);
    const v15_bid_vol = currentTicks.reduce((acc, t) => acc + t.bidVolume, 0);

    const advFactor = 50000000; 
    const avgSpread = currentTicks.reduce((acc, t) => acc + t.spread, 0) / currentTicks.length;
    const lixi = -Math.log10(avgSpread || 0.01) + 0.5 * Math.log10(v10 || 1) + 0.5 * Math.log10(advFactor);

    const v11_22 = currentTicks.map((t, i) => i > 0 ? t.mid - currentTicks[i-1].mid : 0);

    let label = TickLabel.STATIONARY;
    if (ratio > (1 + this.alpha)) label = TickLabel.UPWARDS;
    else if (ratio < (1 - this.alpha)) label = TickLabel.DOWNWARDS;

    return {
      id: crypto.randomUUID(),
      ticks: [...currentTicks],
      meanMid,
      features: {
        v1_mid: meanMid,
        v2_spread: avgSpread,
        v3_crossing_return: v3,
        v9_volatility: v9,
        v10_intensity: v10,
        v14_ask_vol,
        v15_bid_vol,
        v11_22_derivatives: v11_22
      },
      lixi,
      label,
      ratio,
      timestamp: new Date().toLocaleTimeString()
    };
  }
}

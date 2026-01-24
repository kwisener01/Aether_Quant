
import { Tick, TickLabel, TickWindow } from "../types";

const generateSafeId = () => {
  try {
    return (window.crypto && window.crypto.randomUUID) 
      ? window.crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  } catch (e) {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }
};

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
  private alpha = 1e-5; 

  constructor(token: string, isSandbox: boolean = false) {
    this.token = token;
    this.baseUrl = isSandbox 
      ? 'https://sandbox.tradier.com/v1' 
      : 'https://api.tradier.com/v1';
  }

  private async fetchTradier(endpoint: string, method: string = 'GET', body?: any) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); 

    try {
      const options: RequestInit = {
        method,
        headers: { 'Authorization': `Bearer ${this.token}`, 'Accept': 'application/json' },
        signal: controller.signal
      };
      if (body) {
        options.body = JSON.stringify(body);
        options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      }
      const response = await fetch(`${this.baseUrl}${endpoint}`, options);
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Tradier API error: ${response.status}`);
      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
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
    // For Monday open, ensure we look back to Friday for context but prioritize today's bars
    start.setDate(start.getDate() - 3);
    const startStr = `${start.toISOString().split('T')[0]} 09:30`;
    const data = await this.fetchTradier(`/markets/timesales?symbol=${symbol}&interval=1min&start=${startStr}&session=true`);
    if (!data.series || !data.series.data) return [];
    return Array.isArray(data.series.data) ? data.series.data : [data.series.data];
  }

  calculateWindowLabel(currentTicks: Tick[], lastWindowMid: number): TickWindow {
    const meanMid = currentTicks.reduce((acc, t) => acc + t.mid, 0) / currentTicks.length;
    const ratio = meanMid / lastWindowMid;
    const first = currentTicks[0];
    const last = currentTicks[currentTicks.length - 1];
    const v3 = (last.bid - first.ask) / (first.ask || 1);
    const variance = currentTicks.reduce((acc, t) => acc + Math.pow(t.mid - meanMid, 2), 0) / currentTicks.length;
    const v9 = Math.sqrt(variance);
    const v10 = currentTicks.reduce((acc, t) => acc + t.volume, 0);
    const v14_ask_vol = currentTicks.reduce((acc, t) => acc + t.askVolume, 0);
    const v15_bid_vol = currentTicks.reduce((acc, t) => acc + t.bidVolume, 0);

    // DYNAMIC LIXI SCALING: Adjusted to use real Volume (v10) more aggressively
    // This makes the Monday 9:30AM spikes significantly more pronounced
    const advFactor = 50000000; 
    const avgSpread = currentTicks.reduce((acc, t) => acc + t.spread, 0) / currentTicks.length;
    
    // Weighted formula: Intensity (v10) now has a larger coefficient for "actual" feel
    const lixi = -Math.log10(avgSpread || 0.01) + 0.65 * Math.log10(v10 || 1) + 0.4 * Math.log10(advFactor);

    let label = TickLabel.STATIONARY;
    if (ratio > (1 + this.alpha)) label = TickLabel.UPWARDS;
    else if (ratio < (1 - this.alpha)) label = TickLabel.DOWNWARDS;

    return {
      id: generateSafeId(),
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
        v11_22_derivatives: currentTicks.map((t, i) => i > 0 ? t.mid - currentTicks[i-1].mid : 0)
      },
      lixi: Math.min(lixi, 15), // Cap for UI stability
      label,
      ratio,
      timestamp: new Date().toLocaleTimeString()
    };
  }
}

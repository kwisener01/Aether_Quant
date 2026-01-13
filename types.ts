
export enum MarketSentiment {
  BULLISH = 'BULLISH',
  BEARISH = 'BEARISH',
  NEUTRAL = 'NEUTRAL',
  VOLATILE = 'VOLATILE'
}

export interface PricePoint {
  time: string;
  price: number;
  volume: number;
  gamma?: number; // Optional historical GEX
  vanna?: number; // Optional historical Vanna
}

export interface MarketData {
  symbol: string;
  currentPrice: number;
  change24h: number;
  volume24h: number;
  vix: number;
  history: PricePoint[];
  gamma?: number; // Current Total Gamma Exposure (GEX)
  vanna?: number; // Current Vanna Exposure level
}

export interface Signal {
  type: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  liquidityZone: string;
}

export interface HistoricalSignal extends Signal {
  id: string;
  symbol: string;
  timestamp: string;
  chartTime: string; // The specific time string used on the chart X-axis
  priceAtSignal: number;
}

export interface AnalysisResponse {
  sentiment: MarketSentiment;
  liquidityScore: number;
  signal: Signal;
  macroFactors: string[];
}

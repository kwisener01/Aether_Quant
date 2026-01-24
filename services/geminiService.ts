
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, AnalysisResponse, TickWindow, SentimentAnalysis } from "../types";

// Using Flash for search-heavy tasks to prevent "spinning" latency
const SEARCH_MODEL = 'gemini-3-flash-preview'; 
const ANALYSIS_MODEL = 'gemini-3-pro-preview'; 

const SYSTEM_INSTRUCTION = `
You are the "Aether Oracle," an institutional-grade HFT ensemble coordinator.
Objective: Execute the Rocket Scooter methodology using a 100-model Elastic Net (ENet) Ensemble.
Respond ONLY with valid JSON.
`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeJsonResponse = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.includes('```')) {
    const matches = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (matches && matches[1]) {
      cleaned = matches[1].trim();
    }
  }
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  }
  return cleaned;
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error?.message?.toLowerCase() || "";
    if (retries > 0 && (errorMsg.includes('429') || errorMsg.includes('resource_exhausted') || errorMsg.includes('deadline'))) {
      await sleep(delay);
      return withRetry(fn, retries - 1, delay * 1.5);
    }
    throw error;
  }
};

export const fetchMarketDataViaSearch = async (symbol: string): Promise<any> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `REAL-TIME QUANT DATA RETRIEVAL:
    Search for today's specific institutional levels for ${symbol}.
    1. Metrics: currentPrice, change24h, vix (CBOE Volatility Index).
    2. Institutional Levels: 
       - hp: "Weekly Call Wall" or "Max Gamma" price level.
       - mhp: "Monthly Call Wall" or "Major Support/Resistance Gamma".
       - gammaFlip: The price where gamma flips from positive to negative.
       - maxGamma: Highest GEX concentration level.
       - vannaPivot: The key vanna sensitivity level for today's expiration.
       - yesterdayClose, todayOpen.
    3. Historical Series: Provide a SUBSTANTIAL list (minimum 100-150 points) of 1-minute candle close prices for the ENTIRE CURRENT session.
    
    IMPORTANT: Return numbers as numbers, not strings. Ensure the JSON is valid.
    Return JSON format only: 
    {
      "currentPrice": number,
      "change24h": number,
      "vix": number,
      "hp": number,
      "mhp": number,
      "gammaFlip": number,
      "maxGamma": number,
      "vannaPivot": number,
      "yesterdayClose": number,
      "todayOpen": number,
      "history": [{"time": "HH:MM", "price": number, "volume": number}]
    }`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    const rawText = response.text || '{}';
    try {
      const parsed = JSON.parse(sanitizeJsonResponse(rawText));
      
      // Robust conversion of all keys to Numbers to prevent .toFixed errors
      const numericKeys = ['currentPrice', 'change24h', 'vix', 'hp', 'mhp', 'gammaFlip', 'maxGamma', 'vannaPivot', 'yesterdayClose', 'todayOpen'];
      numericKeys.forEach(key => {
        if (parsed[key] !== undefined) {
          parsed[key] = parseFloat(parsed[key]) || 0;
        }
      });

      if (parsed.history && Array.isArray(parsed.history)) {
        parsed.history = parsed.history.map((h: any) => ({
          ...h,
          price: parseFloat(h.price) || 0,
          volume: parseFloat(h.volume) || (Math.floor(Math.random() * 5000) + 2000)
        })).filter((h: any) => h.price > 0);
      }
      return parsed;
    } catch (parseErr) {
      console.error("Search Grounding Parse Error", rawText);
      return { currentPrice: 0, history: [] };
    }
  });
};

export const fetchSentimentAnalysis = async (symbol: string): Promise<SentimentAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `SEARCH AND ANALYZE: Current institutional and retail sentiment for ${symbol}. 
    Look for news headlines from the last 6 hours, options order flow sentiment, and Bloomberg/Reuters alerts.
    Return JSON format:
    {
      "score": number (between -100 and 100),
      "label": "FEAR" | "EXTREME FEAR" | "NEUTRAL" | "GREED" | "EXTREME GREED",
      "headlines": [
        { "title": "Headline string", "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", "source": "Source name" }
      ]
    }
    Return 4 headlines total.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    try {
      return JSON.parse(sanitizeJsonResponse(response.text || '{}')) as SentimentAnalysis;
    } catch (err) {
      return { score: 0, label: "NEUTRAL", headlines: [] };
    }
  });
};

export const analyzeMarket = async (data: MarketData, windows: TickWindow[]): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const windowContext = windows.slice(0, 15).map(w => ({
    l: w.label,
    v14: w.features.v14_ask_vol,
    v15: w.features.v15_bid_vol,
    lixi: w.lixi.toFixed(2)
  }));

  const prompt = `${SYSTEM_INSTRUCTION}
    Symbol: ${data.symbol} Price: ${data.currentPrice} VIX: ${data.vix}
    Levels: GF: ${data.levels?.gammaFlip}, HP: ${data.levels?.hp}, VP: ${data.levels?.vannaPivot}, MG: ${data.levels?.maxGamma}
    HFT Predictors (Last 15 Windows): ${JSON.stringify(windowContext)}
    
    Task: Calculate a high-probability trade setup. Focus on Lixi Flow clusters and Institutional Pinning at Levels.
    
    Return JSON: 
    { 
      sentiment, 
      liquidityScore, 
      signal: { 
        type, voteCount, entry, stopLoss, takeProfit, reasoning, executionStatus, isGoldenSetup, liquidityZone,
        ensembleInsights: [
          { category: 'Order Flow Density', weight: 25, sentiment: 'BULLISH'|'BEARISH'|'NEUTRAL', description: 'string' },
          { category: 'Gamma Gravity', weight: 25, sentiment: '...', description: '...' },
          { category: 'Vanna Skew', weight: 25, sentiment: '...', description: '...' },
          { category: 'Macro Pulse', weight: 25, sentiment: '...', description: '...' }
        ]
      }, 
      macroFactors: [] 
    }
  `;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 2000 }
      }
    });

    try {
      const parsed = JSON.parse(sanitizeJsonResponse(response.text || '{}'));
      // Sanitation for the signal numeric values to prevent toFixed crash
      if (parsed.signal) {
        parsed.signal.entry = parseFloat(parsed.signal.entry) || 0;
        parsed.signal.stopLoss = parseFloat(parsed.signal.stopLoss) || 0;
        parsed.signal.takeProfit = parseFloat(parsed.signal.takeProfit) || 0;
        parsed.signal.voteCount = parseInt(parsed.signal.voteCount) || 0;
      }
      return parsed as AnalysisResponse;
    } catch (e) {
      throw new Error("Analysis parsing failed");
    }
  });
};

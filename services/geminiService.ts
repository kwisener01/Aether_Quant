
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, AnalysisResponse, TickWindow } from "../types";

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
  const prompt = `REAL-TIME SEARCH: Get current ${symbol} data. 
    1. Provide: currentPrice, change24h, vix. 
    2. Levels: hp (Weekly Gamma Max), mhp (Monthly Gamma Max), gammaFlip, maxGamma, vannaPivot, yesterdayClose, todayOpen. 
    3. History: Provide 20-30 historical 1-minute price points for the current or last session as a 'history' array: [{ "time": "HH:MM", "price": number }].
    Return JSON ONLY.`;

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
      return JSON.parse(sanitizeJsonResponse(rawText));
    } catch (parseErr) {
      console.error("Parse Error", rawText);
      return { currentPrice: 0, history: [] };
    }
  });
};

export const analyzeMarket = async (data: MarketData, windows: TickWindow[]): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const windowContext = windows.slice(0, 8).map(w => ({
    l: w.label,
    v14: w.features.v14_ask_vol,
    v15: w.features.v15_bid_vol,
    lixi: w.lixi.toFixed(2)
  }));

  const prompt = `${SYSTEM_INSTRUCTION}
    Symbol: ${data.symbol} Price: ${data.currentPrice} VIX: ${data.vix}
    Levels: GF: ${data.levels?.gammaFlip}, HP: ${data.levels?.hp}, VP: ${data.levels?.vannaPivot}
    HFT Predictors: ${JSON.stringify(windowContext)}
    
    Return JSON: 
    { 
      sentiment, 
      liquidityScore, 
      signal: { 
        type, voteCount, entry, stopLoss, takeProfit, reasoning, executionStatus, isGoldenSetup, liquidityZone,
        ensembleInsights: [
          { category: 'Momentum', weight: 30, sentiment: 'BULLISH'|'BEARISH'|'NEUTRAL', description: 'string' },
          { category: 'Mean Reversion', weight: 30, sentiment: '...', description: '...' },
          { category: 'Order Flow', weight: 20, sentiment: '...', description: '...' },
          { category: 'Macro/Sentiment', weight: 20, sentiment: '...', description: '...' }
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

    return JSON.parse(sanitizeJsonResponse(response.text || '{}')) as AnalysisResponse;
  });
};

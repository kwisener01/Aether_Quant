
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, AnalysisResponse, TickWindow } from "../types";

const ANALYSIS_MODEL = 'gemini-3-pro-image-preview'; 
const SEARCH_MODEL = 'gemini-3-pro-image-preview'; 

const SYSTEM_INSTRUCTION = `
You are the "Aether Oracle," an institutional-grade HFT ensemble coordinator.
Objective: Execute the Rocket Scooter methodology using a 100-model Elastic Net (ENet) Ensemble.

EXECUTION PROTOCOL:
1. BULLISH: HP > MHP. 
2. BEARISH: MHP > HP. 
3. SQUEEZE: HP == MHP.
4. CONFIDENCE: Vote count (X/100). 70+ required for "RISK ON".

Respond ONLY with valid JSON inside a code block.
`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeJsonResponse = (text: string): string => {
  let cleaned = text.trim();
  // Handle markdown code blocks if present
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

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 3000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error?.message?.toLowerCase() || "";
    if (retries > 0 && (errorMsg.includes('429') || errorMsg.includes('resource_exhausted'))) {
      await sleep(delay);
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const fetchMarketDataViaSearch = async (symbol: string): Promise<any> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Search for current ${symbol} data. Provide: currentPrice, change24h, vix. Institutional Levels: hp (Weekly Gamma Max), mhp (Monthly Gamma Max), gammaFlip, maxGamma, vannaPivot, yesterdayClose, todayOpen. Return JSON ONLY.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        // responseMimeType is not supported for gemini-3-pro-image-preview
      }
    });

    const rawText = response.text || '{}';
    try {
      const json = JSON.parse(sanitizeJsonResponse(rawText));
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const citations = chunks.map((chunk: any) => ({
        title: chunk.web?.title || 'Grounding Source',
        uri: chunk.web?.uri
      })).filter((c: any) => c.uri);

      return { ...json, citations };
    } catch (parseErr) {
      console.error("Manual Parse Failure", rawText);
      throw new Error("INVALID_SEARCH_FORMAT");
    }
  });
};

export const analyzeMarket = async (data: MarketData, windows: TickWindow[], isRetrainEvent: boolean = false): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const windowContext = windows.slice(0, 10).map(w => ({
    l: w.label,
    v14: w.features.v14_ask_vol,
    v15: w.features.v15_bid_vol,
    lixi: w.lixi.toFixed(2)
  }));

  const prompt = `${SYSTEM_INSTRUCTION}
    Data: Symbol: ${data.symbol} Price: ${data.currentPrice} VIX: ${data.vix}
    Levels: GF: ${data.levels?.gammaFlip}, HP: ${data.levels?.hp}, VP: ${data.levels?.vannaPivot}
    HFT Predictors: ${JSON.stringify(windowContext)}
    Required Output JSON: { sentiment, liquidityScore, signal: { type: 'BUY'|'SELL'|'WAIT', voteCount, entry, stopLoss, takeProfit, reasoning, executionStatus: 'RISK ON'|'SIT OUT', isGoldenSetup, liquidityZone }, macroFactors: [] }
  `;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 4000 }
      }
    });

    const rawText = response.text || '{}';
    return JSON.parse(sanitizeJsonResponse(rawText)) as AnalysisResponse;
  });
};

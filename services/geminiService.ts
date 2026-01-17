
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, AnalysisResponse, TickWindow } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Switching to 2.5 series which often has more stable quotas during high-demand periods for the 3.0 models
const ANALYSIS_MODEL = 'gemini-2.5-flash-preview'; 
const SEARCH_MODEL = 'gemini-2.5-flash-preview'; 

const SYSTEM_INSTRUCTION = `
You are the "Aether Oracle," an institutional-grade HFT ensemble coordinator.
Objective: Execute the Rocket Scooter methodology using a 100-model Elastic Net (ENet) Ensemble.

EXECUTION PROTOCOL:

1. INSTITUTIONAL BIAS MAP:
   - BULLISH: HP > MHP. Look for "Bullish Long" at HG or HP support.
   - BEARISH: MHP > HP. Look for "Bearish Short" at MHP resistance.
   - SQUEEZE: HP == MHP. Imminent violent expansion.

2. ENET ENSEMBLE VOTING (100 MODELS):
   - Confidence: Vote count (X/100). 70+ required for "RISK ON".
   - Feature Weighting: V14 (Ask Vol) prioritizes UP; V15 (Bid Vol) prioritizes DOWN.

3. ACTIONABLE COMMANDS:
   - GOLDEN SETUP (RISK ON): Bias matches ENet consensus + Price testing pivot.
   - SIT OUT (RISK OFF): D-ZONE conflict or split vote (< 70/100).

4. TARGET PROTOCOL:
   - Never return 0 for entry, stopLoss, or takeProfit. Use HP/MHP/HG pivots as default levels.

Respond strictly with valid JSON.
`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 4000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const isQuotaError = error?.message?.includes('429') || 
                        error?.status === 'RESOURCE_EXHAUSTED' || 
                        error?.message?.includes('RESOURCE_EXHAUSTED');
    
    if (retries > 0 && isQuotaError) {
      console.warn(`[Aether Quant] Quota Limit Hit. Backing off for ${delay}ms... (${retries} retries left)`);
      await sleep(delay);
      return withRetry(fn, retries - 1, delay * 2.5); // More aggressive backoff for 429s
    }
    throw error;
  }
};

const sanitizeJsonResponse = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

export const fetchMarketDataViaSearch = async (symbol: string): Promise<any> => {
  const prompt = `Current SPOT price for ${symbol} (ticker). Institutional levels: HP (Weekly Gamma Max), MHP (Monthly Gamma Max), Yesterday Close, Today Open. Format as JSON: {currentPrice, change24h, vix, hp, mhp, yesterdayClose, todayOpen, history: [{time, price}]}.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            currentPrice: { type: Type.NUMBER },
            change24h: { type: Type.NUMBER },
            vix: { type: Type.NUMBER },
            hp: { type: Type.NUMBER },
            mhp: { type: Type.NUMBER },
            yesterdayClose: { type: Type.NUMBER },
            todayOpen: { type: Type.NUMBER },
            history: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  price: { type: Type.NUMBER }
                }
              }
            }
          },
          required: ["currentPrice", "change24h", "vix", "hp", "mhp", "yesterdayClose", "todayOpen", "history"]
        }
      }
    });

    const rawText = response.text || '{}';
    const json = JSON.parse(sanitizeJsonResponse(rawText));
    
    const citations = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
      title: chunk.web?.title || 'Grounding Source',
      uri: chunk.web?.uri
    })).filter((c: any) => c.uri) || [];

    return { ...json, citations };
  });
};

export const analyzeMarket = async (data: MarketData, windows: TickWindow[], isRetrainEvent: boolean = false): Promise<AnalysisResponse> => {
  const windowContext = windows.slice(0, 10).map(w => ({
    l: w.label,
    v14: w.features.v14_ask_vol,
    v15: w.features.v15_bid_vol,
    lixi: w.lixi.toFixed(2)
  }));

  const prompt = `
    Symbol: ${data.symbol} Price: $${data.currentPrice} | VIX: ${data.vix} | HP: ${data.levels?.hp} | MHP: ${data.levels?.mhp}
    HFT Predictors: ${JSON.stringify(windowContext)}
    Task: Run 100-model ENet ensemble. Output JSON with voteCount and targets.
  `;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingBudget: 4000 }, 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment: { type: Type.STRING },
            liquidityScore: { type: Type.NUMBER },
            signal: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                voteCount: { type: Type.NUMBER },
                entry: { type: Type.NUMBER },
                stopLoss: { type: Type.NUMBER },
                takeProfit: { type: Type.NUMBER },
                reasoning: { type: Type.STRING },
                executionStatus: { type: Type.STRING },
                isGoldenSetup: { type: Type.BOOLEAN },
                liquidityZone: { type: Type.STRING }
              },
              required: ["type", "voteCount", "entry", "executionStatus", "isGoldenSetup", "liquidityZone"]
            },
            macroFactors: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });

    const rawText = response.text || '{}';
    return JSON.parse(sanitizeJsonResponse(rawText)) as AnalysisResponse;
  });
};

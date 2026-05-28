import { GoogleGenAI } from "@google/genai";
import type { CaptureCompletionClient } from "./live.js";

export type GeminiCompletionClientOptions = {
  apiKey: string;
};

export function createGeminiCompletionClient(options: GeminiCompletionClientOptions): CaptureCompletionClient {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    async complete(request) {
      const response = await ai.models.generateContent({
        model: request.model,
        contents: request.userPrompt,
        config: {
          systemInstruction: request.systemPrompt,
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      if (text === undefined || text.length === 0) {
        throw new Error("Gemini returned an empty completion for the Capture Interpretation Prompt.");
      }

      return text;
    }
  };
}

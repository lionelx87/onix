import OpenAI from "openai";
import type { CaptureCompletionClient } from "./live.js";

export type OpenAiCompletionClientOptions = {
  apiKey: string;
};

export function createOpenAiCompletionClient(options: OpenAiCompletionClientOptions): CaptureCompletionClient {
  const client = new OpenAI({ apiKey: options.apiKey });

  return {
    async complete(request) {
      const completion = await client.chat.completions.create({
        model: request.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt }
        ]
      });

      const content = completion.choices[0]?.message.content;
      if (content === null || content === undefined || content.length === 0) {
        throw new Error("OpenAI returned an empty completion for the Capture Interpretation Prompt.");
      }

      return content;
    }
  };
}

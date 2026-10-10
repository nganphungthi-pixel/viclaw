/**
 * Reasoning System - Deep chain-of-thought analysis
 */

import { Provider, Message, createProvider } from "../providers/mod.js";

export interface ReasoningStep {
  step: number;
  thought: string;
  analysis: string;
  conclusion: string;
}

export interface ReasoningResult {
  query: string;
  steps: ReasoningStep[];
  finalAnswer: string;
  confidence: number;
  alternativePerspectives: string[];
  assumptions: string[];
}

export type ReasoningMode = "quick" | "standard" | "deep" | "expert";

const REASONING_PROMPTS: Record<ReasoningMode, string> = {
  quick: "Think briefly and give a concise answer.",
  standard: "Think step by step through the problem. Analyze the key factors, consider pros and cons, and reach a conclusion.",
  deep: "Perform deep reasoning with multiple steps:\n1. Break down the problem into components\n2. Analyze each component thoroughly\n3. Consider edge cases and counter-arguments\n4. Synthesize findings into a comprehensive answer\n5. Review and validate the conclusion",
  expert: "Perform expert-level reasoning with maximum depth:\n1. Define the problem precisely\n2. Identify all relevant factors and variables\n3. Analyze each factor with domain-specific knowledge\n4. Consider multiple perspectives and frameworks\n5. Evaluate trade-offs and uncertainties\n6. Formulate hypotheses and test them mentally\n7. Synthesize a comprehensive conclusion\n8. State assumptions and limitations\n9. Suggest areas for further investigation",
};

export class ReasoningEngine {
  private provider: Provider;
  private mode: ReasoningMode;

  constructor(provider?: Provider, mode?: ReasoningMode) {
    this.provider = provider || createProvider();
    this.mode = mode || "standard";
  }

  setMode(mode: ReasoningMode): void {
    this.mode = mode;
  }

  async reason(query: string): Promise<ReasoningResult> {
    const prompt = REASONING_PROMPTS[this.mode];

    // Step 1: Generate reasoning chain
    const reasoningMessages: Message[] = [
      {
        role: "system",
        content: `You are Viclaw, an expert reasoning engine. ${prompt}\n\nFormat your response with clear numbered steps. For each step include:\n- Thought: What you're considering\n- Analysis: Your detailed reasoning\n- Conclusion: What you determine from this step`,
      },
      {
        role: "user",
        content: `Reason through this: ${query}`,
      },
    ];

    const reasoningResponse = await this.provider.chat(reasoningMessages);

    // Step 2: Parse reasoning steps
    const steps = this.parseSteps(reasoningResponse.content);

    // Step 3: Generate final answer
    const answerMessages: Message[] = [
      {
        role: "system",
        content: `Based on your reasoning above, provide a clear, definitive answer. Include:\n- Your final conclusion\n- Your confidence level (0-100%)\n- Any alternative perspectives\n- Key assumptions you made`,
      },
      {
        role: "user",
        content: query,
      },
      {
        role: "assistant",
        content: reasoningResponse.content,
      },
      {
        role: "user",
        content: "Now provide your final answer with confidence level and alternatives.",
      },
    ];

    const answerResponse = await this.provider.chat(answerMessages);

    // Step 4: Parse final answer
    const { finalAnswer, confidence, alternatives, assumptions } = this.parseAnswer(answerResponse.content);

    return {
      query,
      steps,
      finalAnswer,
      confidence,
      alternativePerspectives: alternatives,
      assumptions,
    };
  }

  private parseSteps(content: string): ReasoningStep[] {
    const steps: ReasoningStep[] = [];
    const stepRegex = /(?:^|\n)\s*(?:\d+\.|step\s*\d+)\s*:?([\s\S]*?)(?=(?:\n\s*\d+\.|\n\s*step\s*\d+|$))/gi;

    let match;
    let stepNum = 1;

    // Fallback: split by numbered lines
    const lines = content.split("\n");
    let currentThought = "";
    let currentAnalysis = "";
    let currentConclusion = "";

    for (const line of lines) {
      const stepMatch = line.match(/^\s*(\d+)[\.\)]\s*(.*)/);
      if (stepMatch) {
        if (currentThought) {
          steps.push({
            step: stepNum++,
            thought: currentThought.trim(),
            analysis: currentAnalysis.trim() || "See thought above",
            conclusion: currentConclusion.trim() || "Derived from analysis",
          });
        }
        currentThought = stepMatch[2];
        currentAnalysis = "";
        currentConclusion = "";
      } else if (line.toLowerCase().includes("analysis") || line.toLowerCase().includes("reasoning")) {
        currentAnalysis += line + "\n";
      } else if (line.toLowerCase().includes("conclusion") || line.toLowerCase().includes("determine")) {
        currentConclusion += line + "\n";
      } else {
        currentThought += line + "\n";
      }
    }

    if (currentThought) {
      steps.push({
        step: stepNum,
        thought: currentThought.trim(),
        analysis: currentAnalysis.trim() || "See thought above",
        conclusion: currentConclusion.trim() || "Derived from analysis",
      });
    }

    // If no steps parsed, treat as single step
    if (steps.length === 0) {
      steps.push({
        step: 1,
        thought: content.slice(0, 500),
        analysis: "Full reasoning provided in thought",
        conclusion: "See above",
      });
    }

    return steps;
  }

  private parseAnswer(content: string): {
    finalAnswer: string;
    confidence: number;
    alternatives: string[];
    assumptions: string[];
  } {
    const confidenceMatch = content.match(/confidence[:\s]*(\d+)[\s%]?/i);
    const confidence = confidenceMatch ? Math.min(100, parseInt(confidenceMatch[1])) : 70;

    const alternatives: string[] = [];
    const altMatch = content.match(/(?:alternative|other)[^\n]*(?:perspective|view|approach)[\s\S]*?(?=\n\n|\n[A-Z]|\Z)/i);
    if (altMatch) {
      alternatives.push(...altMatch[0].split("\n").filter(l => l.trim() && !l.match(/^(alternative|other)/i)).slice(0, 3));
    }

    const assumptions: string[] = [];
    const assumeMatch = content.match(/(?:assumption|assuming|assume)[^\n]*[\s\S]*?(?=\n\n|\n[A-Z]|\Z)/i);
    if (assumeMatch) {
      assumptions.push(...assumeMatch[0].split("\n").filter(l => l.trim()).slice(0, 5));
    }

    // Extract final answer (last meaningful paragraph)
    const paragraphs = content.split("\n\n").filter(p => p.trim());
    const finalAnswer = paragraphs.slice(-2).join("\n\n").slice(0, 1000) || content.slice(0, 500);

    return { finalAnswer, confidence, alternatives, assumptions };
  }

  /**
   * Code-specific reasoning
   */
  async reasonAboutCode(code: string, question: string): Promise<ReasoningResult> {
    return this.reason(`Analyze this code and answer: ${question}\n\nCode:\n${code}`);
  }

  /**
   * Architecture reasoning
   */
  async reasonAboutArchitecture(requirements: string, constraints: string = ""): Promise<ReasoningResult> {
    return this.reason(`Design an architecture for these requirements:\n${requirements}\n\nConstraints: ${constraints || "None specified"}`);
  }

  /**
   * Debug reasoning
   */
  async reasonAboutBug(error: string, context: string): Promise<ReasoningResult> {
    return this.reason(`Debug this error:\nError: ${error}\nContext: ${context}\n\nWhat are the possible causes and how would you fix them?`);
  }
}

// Global reasoning engine
let reasoningInstance: ReasoningEngine | null = null;

export function getReasoningEngine(provider?: Provider, mode?: ReasoningMode): ReasoningEngine {
  if (!reasoningInstance) {
    reasoningInstance = new ReasoningEngine(provider, mode);
  }
  return reasoningInstance;
}

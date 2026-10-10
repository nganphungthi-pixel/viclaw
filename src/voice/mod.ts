/**
 * Voice Support - Transcription and TTS
 * Supports OpenAI Whisper, ElevenLabs TTS, and browser Web Speech API
 */

import { createReadStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ============================================
// TRANSCRIPTION (Speech-to-Text)
// ============================================

export interface TranscriptionConfig {
  provider: "openai" | "deepgram" | "whisper-local";
  apiKey?: string;
  model?: string;
  language?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  confidence?: number;
  duration?: number;
}

export class TranscriptionEngine {
  private config: TranscriptionConfig;

  constructor(config?: TranscriptionConfig) {
    this.config = {
      provider: "openai",
      model: "whisper-1",
      language: "en",
      ...config,
    };
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    switch (this.config.provider) {
      case "openai":
        return this.transcribeOpenAI(audioPath);
      case "deepgram":
        return this.transcribeDeepgram(audioPath);
      default:
        return { text: "[Audio transcription not available]", confidence: 0 };
    }
  }

  private async transcribeOpenAI(audioPath: string): Promise<TranscriptionResult> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { text: "[OpenAI API key not set]", confidence: 0 };
    }

    try {
      const formData = new FormData();
      const file = await fetch(`file://${audioPath}`);
      formData.append("file", new Blob([await file.arrayBuffer()]), "audio.webm");
      formData.append("model", this.config.model || "whisper-1");
      if (this.config.language) {
        formData.append("language", this.config.language);
      }

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json() as { text: string; language?: string };

      return {
        text: data.text,
        language: data.language,
        confidence: 1,
      };
    } catch (error) {
      return {
        text: `[Transcription failed: ${error instanceof Error ? error.message : String(error)}]`,
        confidence: 0,
      };
    }
  }

  private async transcribeDeepgram(audioPath: string): Promise<TranscriptionResult> {
    const apiKey = this.config.apiKey || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      return { text: "[Deepgram API key not set]", confidence: 0 };
    }

    try {
      const { readFileSync } = await import("node:fs");
      const audioBuffer = readFileSync(audioPath);

      const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true", {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "audio/webm",
        },
        body: audioBuffer,
      });

      if (!response.ok) {
        throw new Error(`Deepgram API error: ${response.status}`);
      }

      const data = await response.json() as {
        results: {
          channels: Array<{
            alternatives: Array<{
              transcript: string;
              confidence: number;
            }>;
          }>;
        };
      };

      const result = data.results.channels[0]?.alternatives[0];

      return {
        text: result?.transcript || "",
        confidence: result?.confidence || 0,
      };
    } catch (error) {
      return {
        text: `[Transcription failed: ${error instanceof Error ? error.message : String(error)}]`,
        confidence: 0,
      };
    }
  }
}

// ============================================
// TTS (Text-to-Speech)
// ============================================

export interface TTSConfig {
  provider: "openai" | "elevenlabs" | "edge-tts";
  apiKey?: string;
  voice?: string;
  model?: string;
  speed?: number;
}

export interface TTSResult {
  audioPath: string;
  duration?: number;
}

export class TTSEngine {
  private config: TTSConfig;

  constructor(config?: TTSConfig) {
    this.config = {
      provider: "edge-tts",
      voice: "en-US-AriaNeural",
      speed: 1.0,
      ...config,
    };
  }

  async synthesize(text: string): Promise<TTSResult> {
    switch (this.config.provider) {
      case "openai":
        return this.synthesizeOpenAI(text);
      case "elevenlabs":
        return this.synthesizeElevenLabs(text);
      case "edge-tts":
        return this.synthesizeEdgeTTS(text);
      default:
        throw new Error("Unsupported TTS provider");
    }
  }

  private async synthesizeOpenAI(text: string): Promise<TTSResult> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not set");
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model || "tts-1",
        input: text,
        voice: this.config.voice || "alloy",
        speed: this.config.speed || 1.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS error: ${response.status}`);
    }

    const outputPath = join(tmpdir(), `viclaw-tts-${Date.now()}.mp3`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(outputPath, buffer);

    return { audioPath: outputPath };
  }

  private async synthesizeElevenLabs(text: string): Promise<TTSResult> {
    const apiKey = this.config.apiKey || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ElevenLabs API key not set");
    }

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.config.voice || "21m00Tcm4TlvDq8ikWAM"}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS error: ${response.status}`);
    }

    const outputPath = join(tmpdir(), `viclaw-tts-${Date.now()}.mp3`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(outputPath, buffer);

    return { audioPath: outputPath };
  }

  private async synthesizeEdgeTTS(text: string): Promise<TTSResult> {
    // Edge TTS - free, no API key needed
    const outputPath = join(tmpdir(), `viclaw-tts-${Date.now()}.mp3`);

    try {
      // Using edge-tts via subprocess (npm package alternative)
      const { execSync } = await import("node:child_process");
      execSync(`npx edge-tts --text "${text.replace(/"/g, '\\"')}" --write-media "${outputPath}" --voice ${this.config.voice}`, {
        stdio: "pipe",
      });

      return { audioPath: outputPath };
    } catch (error) {
      return {
        audioPath: "",
      };
    }
  }
}

// ============================================
// VOICE SESSION
// ============================================

export interface VoiceSession {
  id: string;
  transcription: TranscriptionEngine;
  tts: TTSEngine;
  isActive: boolean;
}

export class VoiceManager {
  private sessions: Map<string, VoiceSession> = new Map();
  private transcriptionConfig: TranscriptionConfig;
  private ttsConfig: TTSConfig;

  constructor(transcriptionConfig?: TranscriptionConfig, ttsConfig?: TTSConfig) {
    this.transcriptionConfig = {
      provider: "openai",
      ...transcriptionConfig,
    };
    this.ttsConfig = {
      provider: "edge-tts",
      ...ttsConfig,
    };
  }

  async createSession(id?: string): Promise<VoiceSession> {
    const sessionId = id || crypto.randomUUID();

    const session: VoiceSession = {
      id: sessionId,
      transcription: new TranscriptionEngine(this.transcriptionConfig),
      tts: new TTSEngine(this.ttsConfig),
      isActive: true,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(id: string): VoiceSession | undefined {
    return this.sessions.get(id);
  }

  async transcribeAudio(sessionId: string, audioPath: string): Promise<TranscriptionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Voice session not found");
    }
    return session.transcription.transcribe(audioPath);
  }

  async synthesizeSpeech(sessionId: string, text: string): Promise<TTSResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Voice session not found");
    }
    return session.tts.synthesize(text);
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
    }
  }
}

// Global voice manager instance
let voiceManagerInstance: VoiceManager | null = null;

export function getVoiceManager(): VoiceManager {
  if (!voiceManagerInstance) {
    voiceManagerInstance = new VoiceManager();
  }
  return voiceManagerInstance;
}

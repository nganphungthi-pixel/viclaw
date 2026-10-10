/**
 * Voice CLI - Voice interaction for Viclaw
 * Speak to Viclaw, get voice responses
 * Uses Whisper/Deepgram for transcription, TTS for responses
 */

import { getVoiceManager, TranscriptionResult, TTSResult } from '../voice/mod.js';
import { createProvider, Message, Provider } from '../providers/mod.js';
import { spawn, ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';

export interface VoiceCLIConfig {
  transcriptionProvider?: 'openai' | 'deepgram';
  ttsProvider?: 'openai' | 'elevenlabs' | 'edge-tts';
  ttsVoice?: string;
  silenceThreshold?: number;
  maxRecordingSecs?: number;
}

export class VoiceCLI {
  private config: VoiceCLIConfig;
  private provider: Provider;
  private voiceManager: ReturnType<typeof getVoiceManager>;
  private isRecording = false;
  private recorder: ChildProcess | null = null;

  constructor(config: VoiceCLIConfig = {}) {
    this.config = {
      transcriptionProvider: 'openai',
      ttsProvider: 'edge-tts',
      ttsVoice: 'en-US-AriaNeural',
      silenceThreshold: 2,
      maxRecordingSecs: 30,
      ...config,
    };
    this.provider = createProvider();
    this.voiceManager = getVoiceManager();
  }

  /**
   * Start interactive voice chat
   */
  async startVoiceChat(): Promise<void> {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║              🎤 VICLAW VOICE MODE                        ║
╚═══════════════════════════════════════════════════════════╝

🎙️  Transcription: ${this.config.transcriptionProvider}
🔊 TTS: ${this.config.ttsProvider} (${this.config.ttsVoice})

Commands:
  Type to chat normally
  /record - Start voice recording
  /play <text> - Speak text aloud
  /exit - Exit voice mode

Start speaking or type your message...
    `);

    // Start text REPL alongside voice
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🎤 > ',
    });

    rl.prompt();

    rl.on('line', async (input: string) => {
      const trimmed = input.trim();

      if (trimmed === '/exit' || trimmed === 'exit') {
        console.log('👋 Goodbye!');
        rl.close();
        process.exit(0);
      }

      if (trimmed === '/record') {
        await this.recordAndRespond();
        rl.prompt();
        return;
      }

      if (trimmed.startsWith('/play ')) {
        const text = trimmed.slice(6);
        await this.speak(text);
        rl.prompt();
        return;
      }

      if (trimmed) {
        await this.respondToText(trimmed);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\n👋 Goodbye!');
      process.exit(0);
    });
  }

  /**
   * Record voice, transcribe, and respond with voice
   */
  async recordAndRespond(): Promise<void> {
    console.log('\n🎙️  Recording... (press Enter to stop)\n');

    const audioPath = join(tmpdir(), `viclaw-voice-${Date.now()}.webm`);

    // Try to record using platform-specific tools
    try {
      const recordedPath = await this.recordAudio(audioPath);
      
      console.log('\n📝 Transcribing...\n');
      const session = await this.voiceManager.createSession();
      const transcription = await this.voiceManager.transcribeAudio(session.id, recordedPath);

      if (!transcription.text || transcription.text.startsWith('[')) {
        console.log(`❌ Transcription failed: ${transcription.text}`);
        return;
      }

      console.log(`🗣️  You said: "${transcription.text}"\n`);
      console.log('🤔 Thinking...\n');

      // Get AI response
      const response = await this.provider.chat([
        { role: 'system', content: 'You are Viclaw, a helpful AI assistant. Be concise and conversational.' },
        { role: 'user', content: transcription.text },
      ]);

      console.log(`🤖 Viclaw: ${response.content}\n`);
      console.log('🔊 Speaking response...\n');

      await this.speak(response.content);

      // Cleanup
      try { unlinkSync(recordedPath); } catch {}
    } catch (error) {
      console.log(`❌ Voice error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record audio from microphone
   */
  private async recordAudio(outputPath: string): Promise<string> {
    const isWin = process.platform === 'win32';
    const maxSecs = this.config.maxRecordingSecs || 30;

    if (isWin) {
      // Windows: Use PowerShell to record
      console.log('🎙️  Windows recording not fully supported. Using fallback...');
      // Create a dummy file for testing
      writeFileSync(outputPath, Buffer.from([]));
      return outputPath;
    }

    // Linux/Mac: Use ffmpeg or arecord/sox
    return new Promise((resolve, reject) => {
      // Try ffmpeg first
      const proc = spawn('ffmpeg', [
        '-y',
        '-f', 'alsa',
        '-i', 'default',
        '-t', String(maxSecs),
        '-ar', '16000',
        '-ac', '1',
        '-c:a', 'libvorbis',
        outputPath,
      ]);

      let hasData = false;
      proc.stderr?.on('data', () => { hasData = true; });

      proc.on('error', () => {
        // Fallback: try arecord
        const arec = spawn('arecord', [
          '-f', 'S16_LE',
          '-r', '16000',
          '-d', String(maxSecs),
          '-t', 'wav',
          outputPath.replace('.webm', '.wav'),
        ]);

        arec.on('close', () => {
          resolve(outputPath.replace('.webm', '.wav'));
        });

        arec.on('error', (err) => {
          reject(new Error(`No recording tool available: ${err.message}`));
        });
      });

      proc.on('close', () => {
        if (hasData) {
          resolve(outputPath);
        }
      });

      // Auto-stop after maxSecs
      setTimeout(() => {
        proc.kill('SIGTERM');
      }, (maxSecs + 1) * 1000);
    });
  }

  /**
   * Speak text aloud using TTS
   */
  async speak(text: string): Promise<void> {
    try {
      const session = await this.voiceManager.createSession();
      const ttsConfig = this.config.ttsProvider === 'openai'
        ? { provider: 'openai' as const }
        : this.config.ttsProvider === 'elevenlabs'
        ? { provider: 'elevenlabs' as const, voice: this.config.ttsVoice }
        : { provider: 'edge-tts' as const, voice: this.config.ttsVoice };

      // Create new TTS engine with config
      const { TTSEngine } = await import('../voice/mod.js');
      const tts = new TTSEngine(ttsConfig);
      const result = await tts.synthesize(text);

      if (!result.audioPath) {
        console.log('[TTS failed, showing text only]');
        return;
      }

      // Play audio
      await this.playAudio(result.audioPath);

      // Cleanup
      try { unlinkSync(result.audioPath); } catch {}
    } catch (error) {
      console.log(`❌ TTS error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Play audio file
   */
  private async playAudio(audioPath: string): Promise<void> {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    return new Promise((resolve) => {
      let player;

      if (isWin) {
        // Windows: Use PowerShell
        player = spawn('powershell', [
          '-c',
          `(New-Object Media.SoundPlayer '${audioPath}').PlaySync()`
        ]);
      } else if (isMac) {
        // Mac: Use afplay
        player = spawn('afplay', [audioPath]);
      } else {
        // Linux: Try aplay, then paplay, then ffplay
        player = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', audioPath]);
      }

      player.on('close', () => resolve());
      player.on('error', () => {
        console.log(`[Audio saved to: ${audioPath}]`);
        resolve();
      });
    });
  }

  /**
   * Respond to text input (text chat with optional voice)
   */
  async respondToText(text: string): Promise<void> {
    try {
      const response = await this.provider.chat([
        { role: 'system', content: 'You are Viclaw, a helpful AI assistant. Be concise and conversational.' },
        { role: 'user', content: text },
      ]);

      console.log(`\n🤖 ${response.content}\n`);
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Create Voice CLI instance
 */
export function createVoiceCLI(config?: VoiceCLIConfig): VoiceCLI {
  return new VoiceCLI(config);
}

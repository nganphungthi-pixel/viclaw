/**
 * Viclaw Interactive Setup
 * Provider + Model selection wizard
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================
// PROVIDER + MODEL DATABASE
// ============================================================

const PROVIDERS = [
  {
    id: 'ollama',
    name: 'Ollama',
    envVar: 'OLLAMA_HOST',
    defaultUrl: 'http://localhost:11434',
    free: true,
    website: 'https://ollama.com',
    setup: 'https://ollama.com/download',
    models: [
      { id: 'llama3.1', name: 'Llama 3.1', params: '8B/70B', context: '128K', speed: 'Fast', quality: 'Good' },
      { id: 'llama3.2', name: 'Llama 3.2', params: '1B/3B', context: '128K', speed: 'Very Fast', quality: 'Decent' },
      { id: 'qwen2.5', name: 'Qwen 2.5', params: '7B/72B', context: '128K', speed: 'Fast', quality: 'Very Good' },
      { id: 'mistral', name: 'Mistral', params: '7B', context: '32K', speed: 'Very Fast', quality: 'Good' },
      { id: 'codellama', name: 'Code Llama', params: '7B/34B', context: '16K', speed: 'Fast', quality: 'Good (Code)' },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', params: '6.7B/33B', context: '16K', speed: 'Fast', quality: 'Very Good (Code)' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    free: false,
    website: 'https://console.anthropic.com',
    setup: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', context: '200K', input: '$3/M', output: '$15/M', quality: '⭐ Best balance' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', context: '200K', input: '$15/M', output: '$75/M', quality: '👑 Most powerful' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', context: '200K', input: '$3/M', output: '$15/M', quality: 'Proven' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', context: '200K', input: '$0.25/M', output: '$1.25/M', quality: '💰 Cheapest' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    envVar: 'OPENAI_API_KEY',
    keyPrefix: 'sk-',
    free: false,
    website: 'https://platform.openai.com',
    setup: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', context: '128K', input: '$5/M', output: '$15/M', quality: '⭐ Flagship' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', context: '128K', input: '$0.15/M', output: '$0.60/M', quality: '💰 Affordable' },
      { id: 'o1', name: 'o1', context: '200K', input: '$15/M', output: '$60/M', quality: '🧠 Deep reasoning' },
      { id: 'o1-mini', name: 'o1 Mini', context: '128K', input: '$1.10/M', output: '$4.40/M', quality: 'Lightweight reasoning' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-',
    free: true,
    website: 'https://openrouter.ai',
    setup: 'https://openrouter.ai/keys',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', context: '200K', input: '$3/M', output: '$15/M', quality: '⭐ Best' },
      { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', context: '200K', input: '$15/M', output: '$75/M', quality: '👑 Most powerful' },
      { id: 'openai/gpt-4o', name: 'GPT-4o', context: '128K', input: '$5/M', output: '$15/M', quality: '⭐ Flagship' },
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', context: '1M', input: '$0.10/M', output: '$0.40/M', quality: '💰 Cheapest' },
      { id: 'meta-llama/llama-3.1-70b', name: 'Llama 3.1 70B', context: '128K', input: '$0.29/M', output: '$0.39/M', quality: 'Open source' },
      { id: 'mistralai/mistral-large', name: 'Mistral Large', context: '128K', input: '$2/M', output: '$6/M', quality: 'Good' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google (Gemini)',
    envVar: 'GEMINI_API_KEY',
    keyPrefix: '',
    free: true,
    website: 'https://aistudio.google.com',
    setup: 'https://aistudio.google.com/app/apikey',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', context: '1M', input: 'FREE*', output: 'FREE*', quality: '⭐ Best value' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', context: '1M', input: 'FREE*', output: 'FREE*', quality: '💰 Free tier' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', context: '1M', input: '$1.25/M', output: '$10/M', quality: 'Premium' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', context: '2M', input: '$1.25/M', output: '$5/M', quality: '2M context' },
    ],
  },
];

// ============================================================
// DISPLAY HELPERS
// ============================================================

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function banner() {
  console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║                                                              ║\x1b[0m
\x1b[36m║\x1b[0m  \x1b[1m🔥 VICLAW Setup Wizard\x1b[0m                                     \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  Choose your AI provider and model                        \x1b[36m║\x1b[0m
\x1b[36m║                                                              ║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m
  `);
}

function printProviderList(providers) {
  console.log('\x1b[1m\nAvailable AI Providers:\x1b[0m\n');

  providers.forEach((p, i) => {
    const num = i + 1;
    const freeBadge = p.free ? '\x1b[32m[FREE]\x1b[0m' : '\x1b[33m[PAID]\x1b[0m';
    console.log(`  \x1b[36m${num}.\x1b[0m \x1b[1m${p.name}\x1b[0m ${freeBadge}`);
    console.log(`     Website: ${p.website}`);
  });
}

function printModelTable(models, providerName) {
  console.log(`\n\x1b[1m\n${providerName} Models:\x1b[0m\n`);

  const header = `  #  Model                        Context   Input      Output     Quality`;
  console.log(header);
  console.log(`  ${'─'.repeat(80)}`);

  models.forEach((m, i) => {
    const num = `${i + 1}.`.padEnd(3);
    const name = (m.name).padEnd(28);
    const ctx = (m.context).padEnd(9);
    const inp = (m.input).padEnd(10);
    const out = (m.output).padEnd(10);
    const q = m.quality;
    console.log(`  \x1b[36m${num}\x1b[0m \x1b[1m${name}\x1b[0m \x1b[90m${ctx}\x1b[0m \x1b[90m${inp}\x1b[0m \x1b[90m${out}\x1b[0m ${q}`);
  });
}

function readLine(query) {
  return new Promise((resolve) => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readline.question(query, (answer) => {
      readline.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================
// SETUP WIZARD
// ============================================================

async function setupWizard() {
  clearScreen();
  banner();

  // Step 1: Pick provider
  printProviderList(PROVIDERS);

  const providerChoice = await readLine('\n\x1b[1mSelect provider (1-5):\x1b[0m ');
  const providerIdx = parseInt(providerChoice) - 1;

  if (providerIdx < 0 || providerIdx >= PROVIDERS.length) {
    console.log('\n\x1b[31mInvalid selection.\x1b[0m');
    process.exit(1);
  }

  const provider = PROVIDERS[providerIdx];

  // Step 2: Pick model
  clearScreen();
  console.log(`\x1b[1m\nSelected: ${provider.name}\x1b[0m`);
  printModelTable(provider.models, provider.name);

  const modelChoice = await readLine(`\n\x1b[1mSelect model (1-${provider.models.length}):\x1b[0m `);
  const modelIdx = parseInt(modelChoice) - 1;

  if (modelIdx < 0 || modelIdx >= provider.models.length) {
    console.log('\n\x1b[31mInvalid selection.\x1b[0m');
    process.exit(1);
  }

  const model = provider.models[modelIdx];

  // Step 3: API key (if needed)
  let apiKey = '';
  if (!provider.free) {
    clearScreen();
    console.log(`\x1b[1m\nGet API key from:\x1b[0m \x1b[36m${provider.setup}\x1b[0m\n`);

    // Check existing env
    const existingKey = process.env[provider.envVar];
    if (existingKey) {
      const masked = existingKey.slice(0, 8) + '...' + existingKey.slice(-4);
      console.log(`Existing key found: \x1b[33m${masked}\x1b[0m`);
    }

    apiKey = await readLine(`\x1b[1mEnter your ${provider.name} API key:\x1b[0m `);

    if (!apiKey && !existingKey) {
      console.log('\n\x1b[33m⚠️  No API key provided. Setup will exit.\x1b[0m');
      console.log(`You can set it later in .env: ${provider.envVar}=your-key`);
      process.exit(0);
    }
  }

  // Step 4: Write .env
  const envPath = join(process.cwd(), '.env');
  let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';

  // Update or add provider config
  const envVarLine = `${provider.envVar}=${apiKey || process.env[provider.envVar] || ''}`;

  // Remove old lines for this provider
  const lines = envContent.split('\n').filter(l => !l.startsWith(provider.envVar + '=') && !l.startsWith(provider.envVar + ' '));

  // Remove other provider keys to avoid conflicts
  const otherProviders = PROVIDERS.filter(p => p.id !== provider.id);
  const cleanedLines = lines.filter(l => {
    return !otherProviders.some(op => l.startsWith(op.envVar + '=') || l.startsWith(op.envVar + ' '));
  });

  // Add the new provider config
  cleanedLines.push(envVarLine);

  // Add model override
  cleanedLines.push(`${provider.id.toUpperCase()}_MODEL=${model.id}`);

  // Add default provider
  cleanedLines.push(`VICLAW_PROVIDER=${provider.id}`);

  envContent = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n');

  writeFileSync(envPath, envContent);

  // Step 5: Summary
  clearScreen();
  console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║                                                              ║\x1b[0m
\x1b[36m║\x1b[0m  \x1b[1m✅ Setup Complete!\x1b[0m                                               \x1b[36m║\x1b[0m
\x1b[36m║                                                              ║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m

  Provider:  \x1b[1m${provider.name}\x1b[0m
  Model:     \x1b[1m${model.name}\x1b[0m
  Context:   \x1b[90m${model.context}\x1b[0m
  Config:    \x1b[33m.env\x1b[0m

  ${provider.free ? '🟢 No billing needed — runs locally!' : '💰 Billing handled by ' + provider.name + ', not Viclaw.'}

  \x1b[32mReady to go!\x1b[0m

  Run: \x1b[1mnpx tsx src/cli.ts chat\x1b[0m
  `);
}

// ============================================================
// MAIN
// ============================================================

setupWizard().catch(console.error);

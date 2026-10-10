#!/usr/bin/env node
/**
 * Viclaw Post-Install Setup
 * Shows available AI providers and their models - no pressure, just info.
 * AI billing is handled by the provider, not Viclaw.
 */

// ============================================================
// AI PROVIDER MODEL CATALOG
// All pricing is per the provider's public info. Viclaw charges nothing.
// ============================================================

const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    website: 'https://console.anthropic.com',
    signup: 'https://console.anthropic.com/settings/keys',
    envVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', status: 'latest', input: '$3.00/M', output: '$15.00/M', context: '200K', desc: 'Best balance of speed & intelligence' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', status: 'latest', input: '$15.00/M', output: '$75.00/M', context: '200K', desc: 'Most powerful model' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', status: 'previous', input: '$3.00/M', output: '$15.00/M', context: '200K', desc: 'Previous generation, still excellent' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', status: 'previous', input: '$0.25/M', output: '$1.25/M', context: '200K', desc: 'Fast & cheap for simple tasks' },
    ],
  },
  openai: {
    name: 'OpenAI',
    website: 'https://platform.openai.com',
    signup: 'https://platform.openai.com/api-keys',
    envVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', status: 'latest', input: '$5.00/M', output: '$15.00/M', context: '128K', desc: 'Flagship multimodal model' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', status: 'latest', input: '$0.15/M', output: '$0.60/M', context: '128K', desc: 'Affordable & fast' },
      { id: 'o1', name: 'o1', status: 'latest', input: '$15.00/M', output: '$60.00/M', context: '200K', desc: 'Deep reasoning model' },
      { id: 'o1-mini', name: 'o1 Mini', status: 'latest', input: '$1.10/M', output: '$4.40/M', context: '128K', desc: 'Lightweight reasoning' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', status: 'previous', input: '$10.00/M', output: '$30.00/M', context: '128K', desc: 'Previous generation' },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    website: 'https://openrouter.ai',
    signup: 'https://openrouter.ai/keys',
    envVar: 'OPENROUTER_API_KEY',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', status: 'available', input: '$3.00/M', output: '$15.00/M', context: '200K', desc: 'Via OpenRouter' },
      { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', status: 'available', input: '$15.00/M', output: '$75.00/M', context: '200K', desc: 'Via OpenRouter' },
      { id: 'openai/gpt-4o', name: 'GPT-4o', status: 'available', input: '$5.00/M', output: '$15.00/M', context: '128K', desc: 'Via OpenRouter' },
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', status: 'available', input: '$0.10/M', output: '$0.40/M', context: '1M', desc: 'Very cheap via OpenRouter' },
      { id: 'meta-llama/llama-3.1-70b', name: 'Llama 3.1 70B', status: 'available', input: '$0.29/M', output: '$0.39/M', context: '128K', desc: 'Open source via OpenRouter' },
      { id: 'mistralai/mistral-large', name: 'Mistral Large', status: 'available', input: '$2.00/M', output: '$6.00/M', context: '128K', desc: 'Via OpenRouter' },
    ],
    note: 'OpenRouter = access to 200+ models from one key. Some models have free tiers.',
  },
  ollama: {
    name: 'Ollama (FREE - Local)',
    website: 'https://ollama.com',
    signup: 'No account needed. Runs on your machine.',
    envVar: 'OLLAMA_HOST',
    noKeyNeeded: true,
    models: [
      { id: 'llama3.1', name: 'Llama 3.1 (8B/70B)', status: 'latest', input: 'FREE', output: 'FREE', context: '128K', desc: 'Meta\'s open model' },
      { id: 'llama3.2', name: 'Llama 3.2 (1B/3B)', status: 'latest', input: 'FREE', output: 'FREE', context: '128K', desc: 'Lightweight, runs on any laptop' },
      { id: 'mistral', name: 'Mistral 7B', status: 'available', input: 'FREE', output: 'FREE', context: '32K', desc: 'Fast local model' },
      { id: 'qwen2.5', name: 'Qwen 2.5 (7B/72B)', status: 'latest', input: 'FREE', output: 'FREE', context: '128K', desc: 'Strong coding & reasoning' },
      { id: 'codellama', name: 'Code Llama', status: 'available', input: 'FREE', output: 'FREE', context: '16K', desc: 'Code-specialized' },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', status: 'available', input: 'FREE', output: 'FREE', context: '16K', desc: 'Open source coding model' },
    ],
    note: '100% free. Runs on your computer. No internet needed. Best for privacy.',
  },
  gemini: {
    name: 'Google (Gemini)',
    website: 'https://aistudio.google.com',
    signup: 'https://aistudio.google.com/app/apikey',
    envVar: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', status: 'latest', input: 'FREE*', output: 'FREE*', context: '1M', desc: 'Free tier available, very fast' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', status: 'latest', input: 'FREE*', output: 'FREE*', context: '1M', desc: 'Even cheaper, good for simple tasks' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', status: 'latest', input: '$1.25/M', output: '$10.00/M', context: '1M', desc: 'Premium model, 1M context' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', status: 'previous', input: '$1.25/M', output: '$5.00/M', context: '2M', desc: 'Previous generation, 2M context' },
    ],
    note: 'Free tier: 15 requests/min. No credit card needed to start.',
  },
};

// ============================================================
// DISPLAY FUNCTIONS
// ============================================================

function banner() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🔥  VICLAW - World-Class AI Coding Agent                ║
║       Setup Complete ✅                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

function showProviderList() {
  console.log('📡  Available AI Providers:\n');
  console.log('Choose ANY provider. Viclaw works with all of them.');
  console.log('Billing is handled by the provider, not Viclaw.\n');

  let idx = 1;
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const icon = provider.noKeyNeeded ? '🟢 FREE' : '🔑 API Key';
    console.log(`  ${idx}. ${provider.name} ${icon}`);
    console.log(`     Website: ${provider.website}`);
    if (provider.note) console.log(`     Note: ${provider.note}`);
    console.log('');
    idx++;
  }
}

function showProviderDetails(providerKey) {
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    console.log(`Unknown provider: ${providerKey}`);
    return;
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  ${provider.name}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  if (provider.noKeyNeeded) {
    console.log(`  🟢 No API key needed! Just install and run:\n`);
    console.log(`    1. Download: ${provider.website}`);
    console.log(`    2. Install it`);
    console.log(`    3. Run: ollama pull llama3.1`);
    console.log(`    4. Run: viclaw chat`);
    console.log(`\n  Viclaw will auto-detect Ollama. Nothing else needed.`);
  } else {
    console.log(`  Get API Key: ${provider.signup}\n`);
    console.log(`  Set it in .env file: ${provider.envVar}=your-key-here\n`);
  }

  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ Model                              Input       Output  │ Context │`);
  console.log(`  ├─────────────────────────────────────────────────────────────┤`);

  for (const model of provider.models) {
    const statusIcon = model.status === 'latest' ? '⭐' : model.status === 'previous' ? '  ' : '  ';
    const name = model.name.padEnd(35);
    const input = model.input.padEnd(11);
    const output = model.output.padEnd(10);
    const context = model.context.padStart(7);
    console.log(`  │ ${statusIcon} ${name} ${input} ${output} ${context} │`);
  }

  console.log(`  └─────────────────────────────────────────────────────────────┘\n`);

  if (provider.models.length > 0) {
    console.log(`  💡 Viclaw auto-detects your provider from the API key you set.`);
    console.log(`     You can switch models anytime with /model command.\n`);
  }
}

function quickStartGuide() {
  console.log('\n🚀  Quick Start Guide:\n');

  // Check if Ollama is installed
  const hasOllama = process.env.OLLAMA_HOST || false;

  if (hasOllama) {
    console.log('  ✅ Ollama detected! You can start right now:\n');
    console.log('    viclaw chat\n');
    console.log('  (Uses local AI, no API key, no internet needed)\n');
  }

  console.log('  📋 Setup Steps:\n');
  console.log('  1. Pick an AI provider from the list above');
  console.log('  2. Get an API key from their website');
  console.log('  3. Copy .env.example to .env');
  console.log('  4. Add your API key to .env');
  console.log('  5. Run: viclaw chat\n');
  console.log('  That\'s it. Viclaw handles the rest.\n');

  console.log('  💰 Note: You pay the AI provider directly. Viclaw is free.\n');
  console.log('  🔒 Your API key stays on your machine. Never sent anywhere.\n');
}

function showAllModels() {
  console.log('\n📊  All Available AI Models (by provider):\n');

  for (const [key, provider] of Object.entries(PROVIDERS)) {
    console.log(`  ${provider.name}:`);
    for (const model of provider.models) {
      const status = model.status === 'latest' ? ' ⭐ NEW' : '';
      console.log(`    ${model.name.padEnd(30)} ${model.input.padEnd(12)} ${model.output.padEnd(12)} ${model.context.padStart(7)}${status}`);
    }
    console.log('');
  }
}

// ============================================================
// MAIN
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  banner();

  switch (command) {
    case 'providers':
    case '--providers':
      showProviderList();
      break;

    case 'models':
    case '--models':
      showAllModels();
      break;

    case 'ollama':
    case '--ollama':
      showProviderDetails('ollama');
      break;

    case 'anthropic':
    case '--anthropic':
      showProviderDetails('anthropic');
      break;

    case 'openai':
    case '--openai':
      showProviderDetails('openai');
      break;

    case 'openrouter':
    case '--openrouter':
      showProviderDetails('openrouter');
      break;

    case 'gemini':
    case '--gemini':
      showProviderDetails('gemini');
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log(`
Usage: node scripts/setup.js [command]

Commands:
  providers     Show all available AI providers
  models        Show all AI models with pricing
  ollama        Show Ollama setup guide (FREE)
  anthropic     Show Anthropic models & pricing
  openai        Show OpenAI models & pricing
  openrouter    Show OpenRouter models & pricing
  gemini        Show Google Gemini models & pricing
  help          Show this help

No command = shows full setup guide
      `);
      break;

    default:
      // No command = full guide
      showProviderList();
      showAllModels();
      quickStartGuide();
      break;
  }
}

main();

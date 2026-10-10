/**
 * Viclaw TUI - Terminal User Interface
 * Built with Ink (React for CLI)
 * Professional, interactive terminal experience with streaming support
 */

import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { useState, useEffect, useRef } from 'react';

// Types
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error' | 'tool';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface StatusBarProps {
  provider: string;
  model: string;
  thinkingLevel: string;
  isStreaming: boolean;
  messageCount: number;
}

// ============================================
// STATUS BAR
// ============================================

function StatusBar({ provider, model, thinkingLevel, isStreaming, messageCount }: StatusBarProps) {
  const dots = isStreaming ? '⠋⠙⠹⠸⠼⠴⠦⠧'[Math.floor(Date.now() / 100) % 8] : '●';
  const statusColor = isStreaming ? 'yellow' : 'green';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color="cyan">🔥 VICLAW</Text>
        <Text dimColor> | </Text>
        <Text color="yellow">{provider}</Text>
        <Text dimColor> | </Text>
        <Text>{model}</Text>
        <Text dimColor> | </Text>
        <Text color="magenta">{thinkingLevel}</Text>
        <Text dimColor> | </Text>
        <Text color={statusColor}>{dots}</Text>
        <Text dimColor> | </Text>
        <Text color="gray">Msgs: {messageCount}</Text>
      </Box>
    </Box>
  );
}

// ============================================
// MESSAGE LIST
// ============================================

function MessageList({ messages }: { messages: Message[] }) {
  const displayMessages = messages.slice(-10);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {displayMessages.map((msg) => (
        <Box key={msg.id} flexDirection="column" marginBottom={1}>
          {msg.role === 'user' && (
            <Box>
              <Text bold color="cyan">{'>'}</Text>
              <Text> {msg.content}</Text>
            </Box>
          )}
          {msg.role === 'assistant' && (
            <Box flexDirection="column">
              <Box>
                <Text bold color="green">Viclaw:</Text>
              </Box>
              <Box paddingLeft={1}>
                <Text wrap="wrap">{msg.content}</Text>
              </Box>
            </Box>
          )}
          {msg.role === 'tool' && (
            <Box>
              <Text color="yellow">🛠️ {msg.content}</Text>
            </Box>
          )}
          {msg.role === 'error' && (
            <Box>
              <Text bold color="red">❌ Error:</Text>
              <Text color="red"> {msg.content}</Text>
            </Box>
          )}
          {msg.role === 'system' && (
            <Box>
              <Text dimColor>ℹ️ {msg.content}</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

// ============================================
// INPUT BAR
// ============================================

function InputBar({ onSubmit, isProcessing }: { onSubmit: (text: string) => void; isProcessing: boolean }) {
  const [input, setInput] = useState('');

  useInput((inputChar, key) => {
    if (key.return) {
      if (input.trim()) {
        onSubmit(input.trim());
        setInput('');
      }
      return;
    }

    if (key.escape) {
      process.exit(0);
      return;
    }

    if (key.backspace) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (inputChar.length === 1) {
      setInput((prev) => prev + inputChar);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Box>
        <Text bold color="cyan">{'>'}</Text>
        <Text> {input}</Text>
        {isProcessing && <Text color="yellow"> ⠙</Text>}
      </Box>
      <Box>
        <Text dimColor>/help commands • Esc exit • Enter send</Text>
      </Box>
    </Box>
  );
}

// ============================================
// HELP SCREEN
// ============================================

function HelpScreen() {
  const commands = [
    ['/help', 'Show this help'],
    ['/research <q>', 'Multi-engine research'],
    ['/reason <q>', 'Deep reasoning'],
    ['/security', 'Security audit'],
    ['/connectors', 'Browse connector catalog (config metadata)'],
    ['/plugins', 'Browse plugins'],
    ['/skills', 'Browse skills'],
    ['/session', 'Session stats'],
    ['/config', 'Configuration'],
    ['/bughunt', 'Scan for bugs'],
    ['/memory', 'Memory status'],
    ['/clear', 'Clear chat'],
    ['/exit', 'Exit Viclaw'],
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">VICLAW - AI coding agent on your machine</Text>
      <Text></Text>
      <Text bold>Commands:</Text>
      {commands.map(([cmd, desc]) => (
        <Box key={cmd}>
          <Text color="green" bold>{cmd.padEnd(16)}</Text>
          <Text>{desc}</Text>
        </Box>
      ))}
      <Text></Text>
      <Text dimColor>Press any key to return...</Text>
    </Box>
  );
}

// ============================================
// MAIN APP WITH STREAMING
// ============================================

interface StreamingCallback {
  onContent: (chunk: string) => void;
  onToolCall: (tool: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

interface ViclawTUIProps {
  provider: string;
  model: string;
  thinkingLevel: string;
  onMessage: (message: string, callback: StreamingCallback) => Promise<void>;
}

export function ViclawTUI({ provider, model, thinkingLevel, onMessage }: ViclawTUIProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'system',
      content: 'Welcome to Viclaw! Type a message or /help for commands.',
      timestamp: Date.now(),
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const currentResponse = useRef('');

  const handleSubmit = async (text: string) => {
    if (text === '/exit' || text === 'exit') {
      exit();
      return;
    }

    if (text === '/help') {
      setShowHelp(true);
      return;
    }

    if (text === '/clear') {
      setMessages([]);
      return;
    }

    // Add user message
    const userMsgId = Date.now().toString();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, timestamp: Date.now() },
    ]);

    setIsStreaming(true);
    currentResponse.current = '';

    try {
      const assistantMsgId = `${Date.now()}-resp`;
      
      // Add placeholder for streaming response
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true },
      ]);

      await onMessage(text, {
        onContent: (chunk: string) => {
          currentResponse.current += chunk;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: currentResponse.current }
                : m
            )
          );
        },
        onToolCall: (tool: string) => {
          setMessages((prev) => [
            ...prev,
            { id: `tool-${Date.now()}`, role: 'tool', content: `Using: ${tool}`, timestamp: Date.now() },
          ]);
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, isStreaming: false, content: currentResponse.current }
                : m
            )
          );
          setIsStreaming(false);
        },
        onError: (error: Error) => {
          setMessages((prev) => [
            ...prev,
            { id: `err-${Date.now()}`, role: 'error', content: error.message, timestamp: Date.now() },
          ]);
          setIsStreaming(false);
        },
      });
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'error', content: String(error), timestamp: Date.now() },
      ]);
      setIsStreaming(false);
    }
  };

  // Handle help screen dismissal
  useInput((_input, key) => {
    if (showHelp && !key.escape) {
      setShowHelp(false);
    }
  });

  if (showHelp) {
    return <HelpScreen />;
  }

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        provider={provider}
        model={model}
        thinkingLevel={thinkingLevel}
        isStreaming={isStreaming}
        messageCount={messages.length}
      />
      <Box flexGrow={1} borderStyle="single" borderColor="gray">
        <MessageList messages={messages} />
      </Box>
      <InputBar onSubmit={handleSubmit} isProcessing={isStreaming} />
    </Box>
  );
}

// ============================================
// RENDER FUNCTION
// ============================================

export function renderTUI(props: ViclawTUIProps) {
  return render(<ViclawTUI {...props} />, { exitOnCtrlC: false });
}

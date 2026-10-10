/**
 * Agent Loop Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentLoop, createAgentLoop, ThinkingLevel } from '../src/agent/mod.js';

describe('AgentLoop', () => {
  let agent: AgentLoop;

  beforeEach(() => {
    agent = new AgentLoop({
      maxIterations: 5,
      stream: false,
      thinkingLevel: ThinkingLevel.Low,
    });
  });

  it('should create agent loop with defaults', () => {
    expect(agent).toBeDefined();
    const config = agent.getConfig();
    expect(config.maxIterations).toBe(5);
  });

  it('should create agent loop with factory', () => {
    const agent2 = createAgentLoop({
      maxIterations: 10,
    });
    expect(agent2).toBeDefined();
    expect(agent2.getConfig().maxIterations).toBe(10);
  });

  it('should update config', () => {
    agent.updateConfig({ maxIterations: 20 });
    expect(agent.getConfig().maxIterations).toBe(20);
  });

  it('should add messages', () => {
    agent.addMessage('user', 'Viclaw test message');
    const context = agent.getContext();
    expect(context.messages.length).toBeGreaterThan(1);
  });

  it('should reset agent state', async () => {
    agent.addMessage('user', 'Message to clear');
    await agent.reset();
    const context = agent.getContext();
    expect(context.messages.length).toBe(1); // Only system prompt
    expect(context.toolHistory.length).toBe(0);
  });

  it('should return tool history', () => {
    const history = agent.getToolHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it('should return context', () => {
    const context = agent.getContext();
    expect(context.sessionId).toBeDefined();
    expect(context.workingDirectory).toBeDefined();
    expect(context.iteration).toBe(0);
  });
});

describe('Thinking Levels', () => {
  it('should have all thinking levels', () => {
    expect(ThinkingLevel.Low).toBe('low');
    expect(ThinkingLevel.Medium).toBe('medium');
    expect(ThinkingLevel.High).toBe('high');
    expect(ThinkingLevel.XHigh).toBe('xhigh');
  });
});

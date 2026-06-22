const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { safeFetchUrl } = require('../lib/fetchUrl');
const { runSandboxedJs } = require('../lib/runCode');

const router = express.Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const CODE_EXECUTION_ENABLED = process.env.ENABLE_CODE_EXECUTION === 'true';
const MAX_TOOL_ROUNDS = 5;

const tools = [
  { type: 'web_search_20250305', name: 'web_search' },
  {
    name: 'read_url',
    description:
      'Fetch and read the text content of one specific URL the user shared or referenced ' +
      '(as opposed to web_search, which searches the web broadly). Use this whenever the ' +
      'user pastes a link or asks "what does this page say" / "read this for me".',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The full URL to read' } },
      required: ['url']
    }
  }
];

if (CODE_EXECUTION_ENABLED) {
  tools.push({
    name: 'run_code',
    description:
      'Run a short JavaScript snippet in a sandbox and see its output. Useful for checking ' +
      'a calculation or demonstrating what some code actually does. No network or filesystem ' +
      'access is available inside the sandbox.',
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'JavaScript code to execute' } },
      required: ['code']
    }
  });
}

async function executeTool(name, input) {
  if (name === 'read_url') {
    const result = await safeFetchUrl(input.url);
    return JSON.stringify(result);
  }
  if (name === 'run_code' && CODE_EXECUTION_ENABLED) {
    return runSandboxedJs(input.code);
  }
  return JSON.stringify({ error: `Unknown or disabled tool: ${name}` });
}

// Runs the chat/tool-use loop: call the model, and if it asks to use a
// tool we control (read_url / run_code), execute it and feed the result
// back, repeating until the model gives a final answer. web_search is a
// server-side tool Anthropic executes itself, so it doesn't need a loop.
router.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  let working = [...messages];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system:
          'You are Signal, a helpful voice-and-vision AI agent. You can search the web, ' +
          'read a specific URL the user shares with read_url' +
          (CODE_EXECUTION_ENABLED ? ', and run small JS snippets with run_code' : '') +
          '. Keep replies conversational, since they may be read aloud to the user.',
        messages: working,
        tools
      });

      const clientToolCalls = response.content.filter(
        b => b.type === 'tool_use' && (b.name === 'read_url' || b.name === 'run_code')
      );

      if (clientToolCalls.length === 0) {
        return res.json(response);
      }

      working.push({ role: 'assistant', content: response.content });

      const toolResults = await Promise.all(
        clientToolCalls.map(async (call) => ({
          type: 'tool_result',
          tool_use_id: call.id,
          content: await executeTool(call.name, call.input)
        }))
      );
      working.push({ role: 'user', content: toolResults });
    }

    res.status(500).json({ error: 'Too many tool round-trips without a final answer.' });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Failed to reach the model.' });
  }
});

module.exports = router;

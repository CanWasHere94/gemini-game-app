import express from 'express';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import dotenv from 'dotenv';
import { tools } from './tools.js';

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

let selectedModel = 'gemini';
let chatHistory = [];

/**
 * Returns the selected chat model instance (Gemini or OpenAI).
 */
function getChatModel() {
  if (selectedModel === 'openai') {
    return new ChatOpenAI({
      model: 'ollama/llama3', 
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_BASE_URL,
      temperature: 0,
    });
  } else {
    return new ChatGoogleGenerativeAI({
      model: 'models/gemini-2.5-flash',
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0,
    });
  }
}

// Get current LLM
app.get('/api/settings', (req, res) => {
  res.json({ model: selectedModel });
});

// Switch LLM
app.post('/api/settings', (req, res) => {
  const { model } = req.body;
  if (model === 'gemini' || model === 'openai') {
    selectedModel = model;
    chatHistory = []; // reset history on switch
    console.log(`LLM changed to: ${selectedModel}`);
    res.json({ success: true, message: `LLM switched to ${selectedModel}` });
  } else {
    res.status(400).json({ success: false, message: 'Invalid model selection' });
  }
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('User message:', message);

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'You are a helpful assistant.'],
      ['placeholder', '{chat_history}'],
      ['human', '{input}'],
      ['placeholder', '{agent_scratchpad}'],
    ]);

    // Create tool-calling agent
    const agent = await createToolCallingAgent({
      llm: getChatModel(),
      tools,
      prompt,
    });

    // Create executor
    const agentExecutor = new AgentExecutor({
      agent,
      tools,
      verbose: true,
    });

    // Run agent
    const result = await agentExecutor.invoke({
      input: message,
      chat_history: chatHistory,
    });

    // Save history
    chatHistory.push(new HumanMessage(message));
    chatHistory.push(new AIMessage(result.output));

    console.log('Final response:', result.output);
    res.json({ reply: result.output });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'I encountered an issue processing your request. Please try again later.' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

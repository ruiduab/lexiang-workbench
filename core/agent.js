const https = require('https');
const registry = require('./skill-registry');
const db = require('../db/schema');
const { v4: uuidv4 } = require('uuid');
const { searchAsync } = require('../knowledge/search');
const { extractAndUpdateProfile, getProfilePrompt } = require('./profiler');
const { extractAndSaveMemories, getMemoryPrompt } = require('./memory');
const { buildContextMessages } = require('./compressor');
const { recordExperience, getRelevantExperience } = require('./experience');
const { reflectOnAnswer } = require('./reflector');
const { getEvolutionHistory } = require('./evolver');
const { getLearningStatus } = require('./learner');
const { shouldDispatch, dispatch } = require('./dispatcher');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';
const VL_MODEL = 'qwen-vl-plus'; // 图文多模态模型
const AUDIO_MODEL = 'qwen-audio-turbo'; // 音频多模态模型
const MAX_TOOL_ROUNDS = 5;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'; // 图片完整URL前缀

// L1.6 业务规则动态注入：从 DB 读 System Prompt，5秒缓存
// L1.5 同步缓存当前激活的 Persona
const _promptCache = { zh: null, en: null, persona: null, ts: 0 };
const PROMPT_CACHE_TTL = 5000; // 5秒

function getSystemPrompt(lang) {
  const now = Date.now();
  if (now - _promptCache.ts > PROMPT_CACHE_TTL) {
    try {
      const zh = db.prepare('SELECT value FROM bot_config WHERE key = ?').get('system_prompt_zh');
      const en = db.prepare('SELECT value FROM bot_config WHERE key = ?').get('system_prompt_en');
      if (zh) _promptCache.zh = zh.value;
      if (en) _promptCache.en = en.value;
      // L1.5 读取当前激活 Persona
      try {
        const persona = db.prepare('SELECT * FROM personas WHERE is_active = 1 LIMIT 1').get();
        _promptCache.persona = persona || null;
      } catch (e) {
        _promptCache.persona = null;
      }
      _promptCache.ts = now;
    } catch (e) {
      // DB 读失败则用上次缓存（首次失败时降级到空字符串）
    }
  }
  return (lang === 'en' ? _promptCache.en : _promptCache.zh) || '';
}

// Build system prompt with language, RAG context, and user profile
function buildSystemPrompt(ragContext, lang = 'zh', thinkingMode = false, userId = null, userMessage = null) {
  // L1.5 Persona 前缀注入：激活的 Persona 有 prompt_prefix 则 prepend
  const persona = _promptCache.persona;
  const personaPrefix = (persona && persona.prompt_prefix && persona.prompt_prefix.trim())
    ? persona.prompt_prefix.trim() + '\n\n'
    : '';
  let prompt = personaPrefix + getSystemPrompt(lang);
  // 注入用户画像（结构化字段）
  const profileSection = getProfilePrompt(userId);
  if (profileSection) prompt += profileSection;
  // 注入跨会话记忆（自然语言条目）
  const memorySection = getMemoryPrompt(userId);
  if (memorySection) prompt += memorySection;
  // 注入经验记忆（L2.2 高频问题回答策略）
  if (userMessage) {
    const expSection = getRelevantExperience(userMessage);
    if (expSection) prompt += expSection;
  }
  // L2.4 多步任务规划指令（仅中文）
  if (lang !== 'en') {
    prompt += '\n\n当用户的需求涉及多个步骤或复杂决策时（如"帮我制定选购方案"、"比较多款产品"、"系统规划"等），你可以先调用 task_planner 工具拆解任务，再逐步执行各子任务。对于简单问题直接回答，不要过度使用规划。';
  }
  // L2.6 自主进化：注入 optimization_notes
  try {
    const evo = getEvolutionHistory();
    if (evo.notes && evo.notes.trim()) {
      prompt += '\n\n## 持续改进指令\n' + evo.notes.trim();
    }
  } catch (e) {
    // 读取失败不影响主流程
  }
  // L2.8 持续学习：注入 few_shot_demos
  try {
    const learningStatus = getLearningStatus();
    if (learningStatus.fewShotDemos && learningStatus.fewShotDemos.trim()) {
      prompt += '\n\n## 优质回答示范\n以下是一些高质量回答的策略参考（不是固定模板，灵活运用）：\n' + learningStatus.fewShotDemos.trim();
    }
  } catch (e) {
    // 读取失败不影响主流程
  }
  // L2.5 自检指令
  if (lang === 'en') {
    prompt += '\n\nBefore giving your final answer, please verify:\n1. All URLs come from the knowledge base or official Lenovo domains — do not generate URLs yourself\n2. Product specs and prices are consistent with the knowledge base; if unsure, note "Please check the official website for the latest information"\n3. Your answer directly addresses the user\'s question';
  } else {
    prompt += '\n\n在给出最终回答前，请先确认：\n1. 所有 URL 均来自知识库或官方域名，不自行生成\n2. 产品参数、价格与知识库一致，不确定时注明"请以官网为准"\n3. 回答直接回应用户问题';
  }
  if (thinkingMode) {
    prompt += lang === 'en'
      ? '\n\nBefore answering, write your step-by-step reasoning inside <think></think> tags (100-200 words), then give your formal answer.'
      : '\n\n在正式回答之前，请先在 <think></think> 标签内写出你的分析推理过程（100-200字），然后给出正式回答。';
  }
  if (ragContext && ragContext.trim()) {
    const header = lang === 'en'
      ? '## Knowledge Base Results (cite sources at the end of your answer)'
      : '## 知识库检索结果（优先参考以下内容回答，回答末尾需列出引用来源链接）';
    prompt += `\n\n---\n${header}\n\n${ragContext}\n---`;
  }
  return prompt;
}

// 异步生成对话标题（不阻塞主流程）
function generateTitle(convId, userMessage, aiReply) {
  const prompt = `根据下面的用户问题和AI回答，用10个字以内生成一个简洁的对话标题。
只输出标题本身，不加任何标点或引号。

用户问题：${userMessage.slice(0, 200)}
AI回答摘要：${aiReply.slice(0, 200)}`;

  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 30,
    temperature: 0.3
  });

  const req = https.request({
    hostname: 'dashscope.aliyuncs.com',
    path: '/compatible-mode/v1/chat/completions',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const j = JSON.parse(data);
        const title = j.choices?.[0]?.message?.content?.trim().replace(/^["'「『]|["'」』]$/g, '');
        if (title && title.length <= 30) {
          db.prepare('UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title, convId);
        }
      } catch {}
    });
  });
  req.on('error', () => {});
  req.setTimeout(10000, () => req.destroy());
  req.write(body);
  req.end();
}

// 异步生成追问建议（不阻塞主流程），通过回调返回
function generateSuggestions(userMessage, aiReply, lang, callback) {
  const isEn = lang === 'en';
  const prompt = isEn
    ? `Based on this conversation, generate 3 short follow-up questions the user might ask next.
Output ONLY a JSON array of strings, no explanation. Example: ["Q1?","Q2?","Q3?"]

User: ${userMessage.slice(0, 300)}
AI: ${aiReply.slice(0, 300)}`
    : `根据以下对话，生成3个用户可能会继续追问的简短问题。
只输出JSON数组，不要任何解释。示例：["问题1？","问题2？","问题3？"]

用户：${userMessage.slice(0, 300)}
AI：${aiReply.slice(0, 300)}`;

  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150,
    temperature: 0.7
  });

  const req = https.request({
    hostname: 'dashscope.aliyuncs.com',
    path: '/compatible-mode/v1/chat/completions',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const j = JSON.parse(data);
        const content = j.choices?.[0]?.message?.content?.trim() || '';
        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
          const arr = JSON.parse(match[0]);
          if (Array.isArray(arr) && arr.length > 0) callback(arr.slice(0, 3));
        }
      } catch {}
    });
  });
  req.on('error', () => {});
  req.setTimeout(10000, () => req.destroy());
  req.write(body);
  req.end();
}

// Call DashScope OpenAI-compatible API (non-streaming, with tool_calls)
function callLLM(messages, tools, ragContext, lang = 'zh', userId = null, userMessage = null) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt(ragContext, lang, false, userId, userMessage) },
        ...messages
      ],
      tools: tools.length > 0 ? tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema || { type: 'object', properties: {} }
        }
      })) : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined
    });

    const options = {
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('API timeout')); });
    req.write(body);
    req.end();
  });
}

// 带重试的 callLLM（最多重试1次，间隔2s）
async function callLLMWithRetry(messages, tools, ragContext, lang = 'zh', userId = null, userMessage = null) {
  try {
    return await callLLM(messages, tools, ragContext, lang, userId, userMessage);
  } catch (e) {
    if (e.message.includes('timeout') || e.message.includes('ECONNRESET') || e.message.includes('ETIMEDOUT')) {
      console.warn('[Agent] API 第一次失败，2s 后重试:', e.message);
      await new Promise(r => setTimeout(r, 2000));
      return await callLLM(messages, tools, ragContext, lang, userId, userMessage);
    }
    throw e;
  }
}

async function runAgent(userMessage, convId, sessionId, { webSearch = false, lang = 'zh', userId = null } = {}) {
  // Load or create conversation
  if (!convId) {
    convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, session_id) VALUES (?, ?)').run(convId, sessionId || null);
  } else {
    const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(convId);
    if (!exists) {
      db.prepare('INSERT INTO conversations (id, session_id) VALUES (?, ?)').run(convId, sessionId || null);
    }
  }

  // L1.2 摘要压缩：先查历史（不含本轮），构建上下文（摘要+最近原始消息）
  const { messages: historyMessages } = await buildContextMessages(convId, lang);

  // 保存本轮 user 消息（在 buildContextMessages 之后，避免被计入压缩窗口）
  db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)')
    .run(convId, 'user', userMessage);

  const messages = [...historyMessages, { role: 'user', content: userMessage }];

  // Mandatory RAG: hybrid vector + FTS search
  let ragContext = '';
  try {
    const hits = await searchAsync(userMessage, 5);
    if (hits.length > 0) {
      ragContext = hits.map((h, i) => {
        let entry = `[${i + 1}] 《${h.title}》\n${h.content}`;
        if (h.source_url) entry += `\n来源：${h.source_url}`;
        return entry;
      }).join('\n\n');
    }
  } catch (e) {
    // knowledge search failure is non-fatal
  }

  // 用户开启联网搜索时，强制先执行一次搜索
  if (webSearch) {
    try {
      const webResult = await registry.execute('web_search', { query: userMessage });
      if (webResult.found && webResult.results?.length > 0) {
        const webCtx = webResult.results.map((r, i) =>
          `[网络${i + 1}] ${r.title}\n${r.snippet}\n来源：${r.url}`
        ).join('\n\n');
        ragContext += `\n\n---\n## 联网搜索结果（请结合以下实时信息回答）\n\n${webCtx}`;
      }
    } catch (e) {}
  }

  const tools = registry.getTools({ webSearch });
  const toolCallLog = [];
  let finalText = '';
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const response = await callLLMWithRetry(messages, tools, ragContext, lang, userId, userMessage);

    if (response.error) {
      throw new Error(response.error.message || JSON.stringify(response.error));
    }

    const choice = response.choices?.[0];
    if (!choice) throw new Error('Empty response from LLM');

    const { finish_reason, message } = choice;
    messages.push(message); // Add assistant turn to history

    if (finish_reason === 'tool_calls' && message.tool_calls?.length > 0) {
      // Execute all tools
      const toolResults = await Promise.all(
        message.tool_calls.map(async (tc) => {
          let result;
          try {
            const input = JSON.parse(tc.function.arguments || '{}');
            result = await registry.execute(tc.function.name, input);
            toolCallLog.push({ name: tc.function.name, input, success: true });
          } catch (err) {
            result = { error: err.message };
            toolCallLog.push({ name: tc.function.name, success: false, error: err.message });
          }
          return {
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          };
        })
      );
      messages.push(...toolResults);
      continue;
    }

    // End turn
    finalText = message.content || '';
    break;
  }

  if (!finalText) {
    finalText = '抱歉，我暂时无法处理这个请求，请稍后再试。';
  }

  // Save assistant reply
  db.prepare('INSERT INTO messages (conv_id, role, content, tool_calls) VALUES (?, ?, ?, ?)')
    .run(convId, 'assistant', finalText, toolCallLog.length ? JSON.stringify(toolCallLog) : null);

  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);

  // 首条对话异步生成标题
  const msgCount = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?').get(convId).n;
  if (msgCount <= 2) generateTitle(convId, userMessage, finalText);

  // 异步提取用户画像 + 跨会话记忆（不阻塞响应）
  if (userId) {
    extractAndUpdateProfile(userId, userMessage, finalText).catch(() => {});
    extractAndSaveMemories(userId, userMessage, finalText, convId).catch(() => {});
  }

  // 异步记录经验（L2.2，匿名用户也记录）
  recordExperience(userMessage, finalText).catch(() => {});

  // L2.5 自主反思验证（异步，silent 失败不影响主流程）
  reflectOnAnswer(userMessage, finalText, convId).catch(() => {});

  return { convId, text: finalText, toolCalls: toolCallLog };
}

// ── 流式调用，同时支持 tool_calls 解析 ──
// 返回 { fullText, toolCalls: null | Array, finishReason }
// 如果 finish_reason=tool_calls，则 toolCalls 是完整的工具调用数组，fullText=''
// 如果 finish_reason=stop，则 toolCalls=null，内容已通过 onChunk 实时推送
function callLLMStream(messages, tools, ragContext, onChunk, lang = 'zh', { thinkingMode = false, onThinking, onThinkEnd, userId = null, userMessage = null, imageUrl = null, audioUrl = null } = {}) {
  return new Promise((resolve, reject) => {
    // 图片模式用 qwen-vl-plus，音频模式用 qwen-audio-turbo，深度思考模式用 qwq-plus，否则用默认模型
    const hasImage = !!imageUrl;
    const hasAudio = !!audioUrl;
    const useModel = hasAudio ? AUDIO_MODEL : (hasImage ? VL_MODEL : (thinkingMode ? 'qwq-plus' : MODEL));

    // 构造消息列表：有图片或音频时，把最后一条 user 消息改成多模态格式
    let finalMessages = [...messages];
    if (hasImage) {
      // 找到最后一条 user 消息，改为多模态
      const lastUserIdx = finalMessages.map(m => m.role).lastIndexOf('user');
      if (lastUserIdx >= 0) {
        const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${BASE_URL}${imageUrl}`;
        const originalContent = finalMessages[lastUserIdx].content || '';
        finalMessages[lastUserIdx] = {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: fullImageUrl } },
            { type: 'text', text: originalContent }
          ]
        };
      }
    } else if (hasAudio) {
      // 找到最后一条 user 消息，改为音频多模态格式
      const lastUserIdx = finalMessages.map(m => m.role).lastIndexOf('user');
      if (lastUserIdx >= 0) {
        const fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `${BASE_URL}${audioUrl}`;
        const originalContent = finalMessages[lastUserIdx].content || '';
        finalMessages[lastUserIdx] = {
          role: 'user',
          content: [
            { type: 'audio_url', audio_url: { url: fullAudioUrl } },
            { type: 'text', text: originalContent }
          ]
        };
      }
    }

    const bodyObj = {
      model: useModel,
      stream: true,
      stream_options: { include_usage: false },
      messages: [
        { role: 'system', content: buildSystemPrompt(ragContext, lang, false, userId, userMessage) },
        ...finalMessages
      ],
    };
    // qwq-plus 需要 enable_thinking + 不支持 tools
    if (thinkingMode) {
      bodyObj.enable_thinking = true;
    }
    // 有图片（qwen-vl-plus）或音频（qwen-audio-turbo）时不支持 tools；非图片非音频非思考模式才挂 tools
    if (!thinkingMode && !hasImage && !hasAudio && tools.length > 0) {
      bodyObj.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} } }
      }));
      bodyObj.tool_choice = 'auto';
    }
    const body = JSON.stringify(bodyObj);

    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let fullText = '';
      let rawBuf = '';
      let finishReason = null;
      // tool_calls 累积 map: index -> { id, name, arguments }
      const tcMap = {};

      // 思考状态追踪（qwq-plus 用 reasoning_content 字段，非 <think> 标签）
      let thinkingStarted = false;

      res.on('data', raw => {
        rawBuf += raw.toString();
        const lines = rawBuf.split('\n');
        rawBuf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const choice = j.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;
            const delta = choice.delta;
            // qwq-plus: reasoning_content 字段包含思考内容
            if (delta.reasoning_content && onThinking) {
              thinkingStarted = true;
              onThinking(delta.reasoning_content);
            }
            // 正式回复内容
            if (delta.content) {
              // 思考结束，切换到正式回复
              if (thinkingStarted && onThinkEnd) { onThinkEnd(); thinkingStarted = false; }
              fullText += delta.content;
              onChunk(delta.content);
            }
            // 累积 tool_calls delta
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!tcMap[idx]) tcMap[idx] = { id: '', name: '', arguments: '' };
                if (tc.id) tcMap[idx].id = tc.id;
                if (tc.function?.name) tcMap[idx].name += tc.function.name;
                if (tc.function?.arguments) tcMap[idx].arguments += tc.function.arguments;
              }
            }
          } catch {}
        }
      });

      res.on('end', () => {
        if (thinkingStarted && onThinkEnd) onThinkEnd();
        const toolCalls = finishReason === 'tool_calls'
          ? Object.values(tcMap).map((tc, i) => ({
              id: tc.id || `call_${i}`,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments }
            }))
          : null;
        resolve({ fullText, toolCalls, finishReason });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(thinkingMode ? 180000 : 90000, () => { req.destroy(); reject(new Error('stream timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * 流式版 agent：工具调用轮次非流式，最终回复流式推送
 * @param {string} userMessage
 * @param {string|null} convId
 * @param {string|null} sessionId
 * @param {function} onChunk  - 每收到一段文字调用
 * @param {function} onDone   - 全部完成后调用，参数 {convId, fullText}
 */
async function runAgentStream(userMessage, convId, sessionId, onChunk, onDone, { webSearch = false, lang = 'zh', onSuggestions, onStatus, thinkingMode = false, onThinking, onThinkEnd, userId = null, imageUrl = null, audioUrl = null } = {}) {
  if (!convId) {
    convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, session_id) VALUES (?, ?)').run(convId, sessionId || null);
  } else {
    const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(convId);
    if (!exists) db.prepare('INSERT INTO conversations (id, session_id) VALUES (?, ?)').run(convId, sessionId || null);
  }

  // L1.2 摘要压缩：先查历史（不含本轮），构建上下文
  const { messages: historyMessages } = await buildContextMessages(convId, lang);
  db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'user', userMessage);
  const messages = [...historyMessages, { role: 'user', content: userMessage }];

  let ragContext = '';
  try {
    if (onStatus) onStatus({ type: 'rag', text: lang === 'en' ? 'Searching knowledge base…' : '检索知识库…' });
    const hits = await searchAsync(userMessage, 5);
    if (hits.length > 0) {
      ragContext = hits.map((h, i) => {
        let entry = `[${i + 1}] 《${h.title}》\n${h.content}`;
        if (h.source_url) entry += `\n来源：${h.source_url}`;
        return entry;
      }).join('\n\n');
    }
    if (onStatus) onStatus({ type: 'rag_done', text: lang === 'en' ? `Found ${hits.length} references` : `找到 ${hits.length} 条参考`, count: hits.length });
  } catch {}

  // 用户开启联网搜索时，强制先执行一次搜索，结果塞进上下文（不依赖 LLM 自行调用）
  if (webSearch) {
    try {
      if (onStatus) onStatus({ type: 'tool', name: 'web_search' });
      const webResult = await registry.execute('web_search', { query: userMessage });
      if (onStatus) onStatus({ type: 'tool_done', name: 'web_search', success: true });
      if (webResult.found && webResult.results?.length > 0) {
        const webCtx = webResult.results.map((r, i) =>
          `[网络${i + 1}] ${r.title}\n${r.snippet}\n来源：${r.url}`
        ).join('\n\n');
        const header = lang === 'en' ? '## Web Search Results' : '## 联网搜索结果（请结合以下实时信息回答）';
        ragContext += `\n\n---\n${header}\n\n${webCtx}`;
      }
    } catch (e) {
      if (onStatus) onStatus({ type: 'tool_done', name: 'web_search', success: false });
    }
  }

  // L2.7 多Agent协作：检查是否分发给子 Agent
  const subAgent = shouldDispatch(userMessage);
  if (subAgent) {
    let subText = '';
    let subProducts = [];
    try {
      const result = await dispatch(subAgent, userMessage, historyMessages, ragContext, onChunk);
      subText = result.text;
      subProducts = result.products || [];
    } catch (e) {
      console.warn(`[Agent] SubAgent ${subAgent.name} failed, fallback to main agent:`, e.message);
      subText = ''; // 失败则 fallback，subText 为空继续走主流程
    }

    if (subText) {
      // 保存消息、更新对话
      const subInsert = db.prepare('INSERT INTO messages (conv_id, role, content, tool_calls) VALUES (?, ?, ?, ?)').run(convId, 'assistant', subText, null);
      db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);
      const msgCount2 = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?').get(convId).n;
      if (msgCount2 <= 2) generateTitle(convId, userMessage, subText);
      if (userId) {
        extractAndUpdateProfile(userId, userMessage, subText).catch(() => {});
        extractAndSaveMemories(userId, userMessage, subText, convId).catch(() => {});
      }
      recordExperience(userMessage, subText).catch(() => {});
      reflectOnAnswer(userMessage, subText, convId).catch(() => {});
      if (onDone) onDone({ convId, fullText: subText, msgId: subInsert.lastInsertRowid, products: subProducts });
      generateSuggestions(userMessage, subText, lang, (suggestions) => {
        if (onSuggestions) onSuggestions(suggestions);
      });
      return;
    }
    // subText 为空说明子 Agent 失败，继续走主 Agent 流程
  }

  const tools = registry.getTools({ webSearch });
  const toolCallLog = [];
  let rounds = 0;
  let fullText = '';

  // 全程流式：第一轮直接流式推送，若返回 tool_calls 则执行工具后继续
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    // 图片/音频只在第一轮传入（多模态模型不支持 tools，第一轮不会有 tool_calls）
    const roundImageUrl = rounds === 1 ? imageUrl : null;
    const roundAudioUrl = rounds === 1 ? audioUrl : null;
    const { fullText: streamedText, toolCalls } = await callLLMStream(
      messages, tools, ragContext, onChunk, lang,
      { thinkingMode, onThinking, onThinkEnd, userId, userMessage, imageUrl: roundImageUrl, audioUrl: roundAudioUrl }
    );

    if (toolCalls && toolCalls.length > 0) {
      // 有工具调用：执行工具，后续轮次不再推送 onChunk（只有最终回复才推送）
      messages.push({ role: 'assistant', content: streamedText || null, tool_calls: toolCalls });
      const toolResults = await Promise.all(toolCalls.map(async (tc) => {
        if (onStatus) onStatus({ type: 'tool', name: tc.function.name });
        let result;
        try {
          const input = JSON.parse(tc.function.arguments || '{}');
          result = await registry.execute(tc.function.name, input);
          toolCallLog.push({ name: tc.function.name, input, success: true });
          if (onStatus) onStatus({ type: 'tool_done', name: tc.function.name, success: true });
        } catch (err) {
          result = { error: err.message };
          toolCallLog.push({ name: tc.function.name, success: false, error: err.message });
          if (onStatus) onStatus({ type: 'tool_done', name: tc.function.name, success: false });
        }
        return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
      }));
      messages.push(...toolResults);
      continue;
    }

    // 无工具调用，已流式推送完毕
    fullText = streamedText;
    break;
  }
  const text = fullText || '抱歉，我暂时无法处理这个请求，请稍后再试。';

  const insertResult = db.prepare('INSERT INTO messages (conv_id, role, content, tool_calls) VALUES (?, ?, ?, ?)').run(convId, 'assistant', text, toolCallLog.length ? JSON.stringify(toolCallLog) : null);
  const lastMsgId = insertResult.lastInsertRowid;
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);

  // 首条对话异步生成标题
  const msgCount = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?').get(convId).n;
  if (msgCount <= 2) generateTitle(convId, userMessage, text);

  // 异步更新用户画像 + 跨会话记忆
  if (userId) {
    extractAndUpdateProfile(userId, userMessage, text).catch(() => {});
    extractAndSaveMemories(userId, userMessage, text, convId).catch(() => {});
  }

  // 异步记录经验（L2.2，匿名用户也记录）
  recordExperience(userMessage, text).catch(() => {});

  // L2.5 自主反思验证（异步，silent 失败不影响主流程）
  reflectOnAnswer(userMessage, text, convId).catch(() => {});

  // 异步生成追问建议，通过 onSuggestions 回调推送（不阻塞 done 事件）
  if (onDone) onDone({ convId, fullText: text, msgId: lastMsgId });
  generateSuggestions(userMessage, text, lang, (suggestions) => {
    if (onSuggestions) onSuggestions(suggestions);
  });
}

module.exports = { runAgent, runAgentStream };

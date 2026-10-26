#!/usr/bin/env node
/**
 * Cost-Aware Routing Demo — web app for DigitalOcean App Platform
 *
 * Same demo as ../demo.js, served as a small HTTP app so it can run as a
 * clickable, always-on URL instead of a one-off CLI script. Visit the
 * landing page, click "Run comparison," and it calls DigitalOcean's
 * Inference Router live (budget vs quality routing_preference) and renders
 * the same side-by-side report in the browser.
 *
 * No external dependencies — Node.js 18+ standard library + built-in fetch
 * only. Listens on process.env.PORT (App Platform sets this).
 *
 * Env vars:
 *   MODEL_ACCESS_KEY   DigitalOcean Serverless Inference model access key.
 *                      Required unless DRY_RUN=true.
 *   DRY_RUN            Set to "true" to use canned mock data instead of
 *                      calling the live API — good for a first deploy
 *                      before you've added a real key or balance.
 *   PORT               HTTP port to listen on (App Platform sets this).
 */

'use strict';

const http = require('http');

const BASE_URL = 'https://inference.do-ai.run';
const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

// ---------------------------------------------------------------------------
// Pricing table, prompts, mock data, router call, cost estimate — identical
// to ../demo.js. See that file's comments for the sourcing/rationale.
// ---------------------------------------------------------------------------
const PRICING_PER_MILLION_TOKENS = {
  'openai-gpt-oss-120b': [0.10, 0.70],
  'openai-gpt-oss-20b': [0.05, 0.45],
  'openai-gpt-4o': [2.50, 10.00],
  'openai-gpt-4o-mini': [0.15, 0.60],
  'openai-gpt-4.1': [2.00, 8.00],
  'openai-gpt-5': [1.25, 10.00],
  'openai-gpt-5-mini': [0.25, 2.00],
  'openai-gpt-5-nano': [0.05, 0.40],
  'openai-gpt-5.2': [1.75, 14.00],
  'openai-gpt-5.3-codex': [1.75, 14.00],
  'openai-gpt-5.4': [2.50, 15.00],
  'openai-gpt-5.4-mini': [0.75, 4.50],
  'openai-gpt-5.4-nano': [0.20, 1.25],
  'openai-gpt-5.5': [5.00, 30.00],
  'openai-o3': [2.00, 8.00],
  'openai-o3-mini': [1.10, 4.40],
  'openai-o1': [15.00, 60.00],
  'deepseek-v4.1-flash': [0.30, 1.20],
  'deepseek-v4.1-flash-1017': [0.30, 1.20],
  'deepseek-v4-pro': [1.74, 3.48],
  'deepseek-v4-pro-0813': [1.32, 3.96],
  'deepseek-4-flash': [0.14, 0.28],
  'deepseek-v4-flash-0731': [0.14, 0.28],
  'deepseek-3.2': [0.50, 1.60],
  'kimi-k3': [3.00, 15.00],
  'kimi-k2.6': [0.95, 4.00],
  'glm-5.3': [1.40, 4.40],
  'glm-5.3-flash': [0.15, 0.50],
  'glm-5.2': [1.40, 4.40],
  'mimo-v2.5-pro': [0.80, 3.00],
  'qwen3.8-max': [2.00, 6.00],
  'qwen3.5-397b-a17b': [0.55, 3.50],
  'llama-4-maverick': [0.25, 0.87],
  'mistral-3-14B': [0.20, 0.20],
  'nemotron-3.5-super-vl': [0.30, 0.65],
  'nemotron-3-ultra-550b': [0.90, 1.70],
  'nemotron-3-nano-omni': [0.50, 0.90],
  'nemotron-nano-12b-v2-vl': [0.20, 0.60],
  'reflection-beam': [0.40, 1.20],
  'minimax-m3.1-flash': [0.15, 0.60],
  'minimax-m2.5': [0.30, 1.20],
  'gemma-4-31B-it': [0.18, 0.50],
  'arcee-trinity-large-thinking': [0.25, 0.90],
  'anthropic-claude-haiku-4.5': [1.00, 5.00],
  'anthropic-claude-5.5-haiku': [0.10, 0.50],
  'anthropic-claude-5-sonnet': [2.00, 10.00],
  'anthropic-claude-sonnet-5.5': [2.00, 10.00],
  'anthropic-claude-4.5-sonnet': [3.00, 15.00],
  'anthropic-claude-4.6-sonnet': [3.00, 15.00],
  'anthropic-claude-opus-4.5': [5.00, 25.00],
  'anthropic-claude-opus-4.6': [5.00, 25.00],
  'anthropic-claude-opus-4.7': [5.00, 25.00],
  'anthropic-claude-opus-4.8': [5.00, 25.00],
  'anthropic-claude-opus-5': [5.00, 25.00],
  'anthropic-claude-opus-5.5': [4.00, 20.00],
  'anthropic-claude-fable-5': [10.00, 50.00],
  'anthropic-claude-fable-5.1': [10.00, 50.00],
};

const PROMPTS = [
  { label: 'Simple factual lookup', complexity: 'simple', text: 'What is the capital of France?' },
  { label: 'Simple unit conversion', complexity: 'simple', text: 'Convert 100 degrees Fahrenheit to Celsius.' },
  { label: 'Simple copywriting', complexity: 'simple', text: 'Write a one-sentence tagline for a neighborhood coffee shop.' },
  { label: 'Simple formatting task', complexity: 'simple', text: 'Reformat this list into alphabetical order: banana, apple, cherry, date.' },
  {
    label: 'Concurrency bug review',
    complexity: 'complex',
    text:
      'Find the bug in this Python code and explain exactly why it happens:\n\n' +
      'import threading\n' +
      'counter = 0\n' +
      'def increment():\n' +
      '    global counter\n' +
      '    for _ in range(100000):\n' +
      '        counter += 1\n' +
      'threads = [threading.Thread(target=increment) for _ in range(4)]\n' +
      '[t.start() for t in threads]\n' +
      '[t.join() for t in threads]\n' +
      "print(counter)  # expected 400000, but it's not always that\n",
  },
  {
    label: 'Rigorous math proof',
    complexity: 'complex',
    text:
      'Write a rigorous step-by-step proof that the square root of 2 ' +
      'is irrational, using proof by contradiction, and point out ' +
      'exactly where a common flawed student proof usually goes wrong.',
  },
  {
    label: 'Systems design',
    complexity: 'complex',
    text:
      'Design a database schema for a multi-tenant SaaS billing system ' +
      'that must support usage-based pricing, mid-cycle plan changes ' +
      'with proration, and multi-currency invoices. Explain the key ' +
      'tradeoffs in your schema.',
  },
  {
    label: 'Production incident triage',
    complexity: 'complex',
    text:
      'Here is a stack trace from a production Kubernetes crash loop. ' +
      'Diagnose the likely root cause and propose a remediation plan:\n\n' +
      'OOMKilled: container exceeded memory limit 512Mi\n' +
      'panic: runtime error: invalid memory address or nil pointer dereference\n' +
      'goroutine 42 [running]:\n' +
      'main.(*Cache).Get(0x0, {0xc0001a4000, 0x10})\n' +
      '    /app/cache.go:58 +0x19\n' +
      'main.handleRequest(...)\n' +
      '    /app/handler.go:102\n',
  },
];

const ROUTING_PREFERENCES = ['budget', 'quality'];

async function callInferenceRouter(modelAccessKey, promptText, routingPreference, baseUrl) {
  const url = baseUrl.replace(/\/$/, '') + CHAT_COMPLETIONS_PATH;
  const start = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modelAccessKey}` },
      body: JSON.stringify({
        model: 'inference-router',
        routing_preference: routingPreference,
        messages: [{ role: 'user', content: promptText }],
      }),
    });
  } catch (err) {
    return { model: null, input_tokens: 0, output_tokens: 0, latency_s: (Date.now() - start) / 1000, error: `Request failed: ${err.message}` };
  }
  const latency_s = (Date.now() - start) / 1000;
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    return { model: null, input_tokens: 0, output_tokens: 0, latency_s, error: `HTTP ${res.status}: ${errBody.slice(0, 300)}` };
  }
  const data = await res.json();
  const usage = data.usage || {};
  return {
    model: data.model,
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    latency_s,
    error: null,
  };
}

function estimateCostUsd(model, inputTokens, outputTokens) {
  const pricing = PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) return null;
  const [inRate, outRate] = pricing;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}

const MOCK_BUDGET_MODELS = ['openai-gpt-oss-20b', 'deepseek-4-flash', 'glm-5.3-flash', 'openai-gpt-oss-20b', 'deepseek-v4-pro', 'kimi-k3', 'anthropic-claude-5-sonnet', 'deepseek-v4-pro'];
const MOCK_QUALITY_MODELS = ['openai-gpt-oss-120b', 'deepseek-4-flash', 'glm-5.3-flash', 'openai-gpt-oss-120b', 'anthropic-claude-opus-5', 'kimi-k3', 'anthropic-claude-opus-5.5', 'anthropic-claude-opus-5'];

function callInferenceRouterMock(promptIndex, routingPreference) {
  const models = routingPreference === 'budget' ? MOCK_BUDGET_MODELS : MOCK_QUALITY_MODELS;
  const model = models[promptIndex % models.length];
  return {
    model,
    input_tokens: 40 + promptIndex * 15,
    output_tokens: 60 + promptIndex * 40,
    latency_s: 0.6 + 0.05 * promptIndex,
    error: null,
  };
}

async function runSinglePromptComparison(prompt, mockIndex, { modelAccessKey, dryRun, baseUrl }) {
  const row = { prompt, runs: {} };
  for (const pref of ROUTING_PREFERENCES) {
    const r = dryRun
      ? callInferenceRouterMock(mockIndex, pref)
      : await callInferenceRouter(modelAccessKey, prompt.text, pref, baseUrl);
    r.cost_usd = r.error === null ? estimateCostUsd(r.model, r.input_tokens, r.output_tokens) : null;
    row.runs[pref] = r;
  }
  return row;
}

async function runComparison({ modelAccessKey, dryRun, baseUrl }) {
  const results = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    results.push(await runSinglePromptComparison(PROMPTS[i], i, { modelAccessKey, dryRun, baseUrl }));
  }
  return results;
}

const MAX_CUSTOM_PROMPT_LEN = 4000;
const MAX_BODY_BYTES = 16 * 1024;

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PAGE_STYLE = `
  :root {
    --do-blue: #0069ff; --do-blue-dark: #0050c4; --ink: #111827; --muted: #6b7280;
    --border: #e5e7eb; --bg: #f7f8fa; --card: #ffffff;
    --budget-bg: #eafbf0; --quality-bg: #eef4ff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--ink); }
  header { background: #03244d; color: #fff; padding: 24px 28px; }
  header h1 { margin: 0 0 4px 0; font-size: 19px; }
  header p { margin: 0; font-size: 13px; color: #9fb4d6; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 24px; }
  .panel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
  .btn { display: inline-block; background: var(--do-blue); color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: 600; font-size: 14px; }
  .btn:hover { background: var(--do-blue-dark); }
  .note { font-size: 13px; color: var(--muted); margin-top: 14px; line-height: 1.6; }
  .summary { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .summary-card { flex: 1; min-width: 200px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
  .summary-card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; margin-bottom: 6px; }
  .summary-card .value { font-size: 26px; font-weight: 700; }
  .summary-card.highlight { background: linear-gradient(135deg, #eafbf0, #eef4ff); border-color: #bfe9cf; }
  .summary-card.highlight .value { color: #0a7d3c; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
  thead th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--border); }
  thead th.budget { background: var(--budget-bg); } thead th.quality { background: var(--quality-bg); }
  td { padding: 14px 16px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .prompt-cell { width: 34%; }
  .badge { display: inline-block; font-size: 10.5px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; margin-bottom: 6px; }
  .badge.simple { background: #eafbf0; color: #0a7d3c; } .badge.complex { background: #fff1e6; color: #b45309; }
  .badge.custom { background: #eef4ff; color: #1d4ed8; }
  .divider { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
  textarea { width: 100%; min-height: 110px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 14px; resize: vertical; }
  .field-note { font-size: 12px; color: var(--muted); margin: 6px 0 14px 0; }
  .prompt-label { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .prompt-text { font-size: 12.5px; color: var(--muted); font-family: ui-monospace, monospace; white-space: pre-wrap; }
  .run-cell.budget { background: var(--budget-bg); } .run-cell.quality { background: var(--quality-bg); }
  .run-cell .model { font-weight: 700; font-size: 13.5px; margin-bottom: 4px; }
  .run-cell .meta { font-size: 12px; color: var(--muted); }
  .run-cell .err { color: #b91c1c; font-size: 12.5px; }
  footer { text-align: center; font-size: 11px; color: var(--muted); padding: 24px; }
  .mode-flag { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; background: #fff1e6; color: #b45309; margin-left: 8px; }
`;

function landingPage({ dryRun, hasKey, error }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Cost-Aware Routing Demo</title><style>${PAGE_STYLE}</style></head><body>
<header>
  <h1>Cost-Aware Routing Demo${dryRun ? '<span class="mode-flag">dry run</span>' : ''}</h1>
  <p>DigitalOcean Inference Router — budget vs quality routing_preference, side by side</p>
</header>
<div class="wrap">
  <div class="panel">
    <p>Click below to send ${PROMPTS.length} prompts (a mix of trivial and genuinely hard questions)
    through DigitalOcean's Inference Router twice each — once with
    <code>routing_preference: budget</code>, once with <code>routing_preference: quality</code> —
    and see which model actually answered each one, and what it cost.</p>
    <p><a class="btn" href="/run">Run comparison &rarr;</a></p>
    <div class="note">
      ${dryRun
        ? 'Running in <strong>dry-run mode</strong> (mock data, no API calls, no cost). Set <code>DRY_RUN=false</code> and a valid <code>MODEL_ACCESS_KEY</code> to go live.'
        : hasKey
          ? 'Running live against your DigitalOcean account. Each click sends 16 real requests and incurs real (small) usage charges.'
          : '<strong>No MODEL_ACCESS_KEY is configured</strong> — live requests will fail. Set it as an app-level secret, or set DRY_RUN=true to demo with mock data.'}
    </div>

    <hr class="divider">

    <h3 style="margin-top:0;">Or try your own prompt</h3>
    <p style="color:var(--muted); font-size:13.5px;">Type any question or task below — it'll be sent through the
    router twice (once per routing preference) so you can see whether it gets routed the same way under both,
    or whether <code>quality</code> reaches for a stronger (pricier) model.</p>
    ${error ? `<div class="note" style="color:#b91c1c;">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/run-custom">
      <textarea name="prompt" maxlength="${MAX_CUSTOM_PROMPT_LEN}" placeholder="e.g. Summarize the tradeoffs between REST and gRPC for an internal microservice."></textarea>
      <div class="field-note">Up to ${MAX_CUSTOM_PROMPT_LEN.toLocaleString()} characters.</div>
      <button class="btn" type="submit" style="border:none; cursor:pointer; font: inherit;">Compare budget vs quality for this prompt &rarr;</button>
    </form>
  </div>
</div>
<footer>Unofficial internal demo. Model and cost data come directly from each Inference Router response plus a local DigitalOcean pricing table.</footer>
</body></html>`;
}

function reportPage(results, { dryRun, title, subtitle }) {
  const totals = { budget: 0, quality: 0 };
  const rowsHtml = [];

  for (const row of results) {
    const p = row.prompt;
    const b = row.runs.budget;
    const q = row.runs.quality;
    if (b.cost_usd !== null) totals.budget += b.cost_usd;
    if (q.cost_usd !== null) totals.quality += q.cost_usd;

    const cell = (r) => {
      if (r.error) return `<div class="err">Error: ${escapeHtml(r.error)}</div>`;
      const costStr = r.cost_usd !== null ? `$${r.cost_usd.toFixed(6)}` : '—';
      return `<div class="model">${escapeHtml(r.model || '?')}</div>
        <div class="meta">${r.input_tokens} in / ${r.output_tokens} out &middot; ${r.latency_s.toFixed(2)}s &middot; <strong>${costStr}</strong></div>`;
    };

    const truncated = p.text.length > 160 ? p.text.slice(0, 160) + '…' : p.text;
    rowsHtml.push(`<tr>
      <td class="prompt-cell">
        <span class="badge ${p.complexity}">${p.complexity}</span>
        <div class="prompt-label">${escapeHtml(p.label)}</div>
        <div class="prompt-text">${escapeHtml(truncated)}</div>
      </td>
      <td class="run-cell budget">${cell(b)}</td>
      <td class="run-cell quality">${cell(q)}</td>
    </tr>`);
  }

  const savingsPct = totals.quality > 0 ? (1 - totals.budget / totals.quality) * 100 : null;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Cost-Aware Routing Demo — Results</title><style>${PAGE_STYLE}</style></head><body>
<header>
  <h1>${title || 'Cost-Aware Routing Demo — Results'}${dryRun ? '<span class="mode-flag">dry run</span>' : ''}</h1>
  <p>${subtitle || 'DigitalOcean Inference Router — budget vs quality routing_preference, same prompts'}</p>
</header>
<div class="wrap">
  <p><a href="/run">Run again &rarr;</a> &middot; <a href="/">Back to start</a></p>
  <div class="summary">
    <div class="summary-card"><div class="label">Total cost — budget routing</div><div class="value">$${totals.budget.toFixed(4)}</div></div>
    <div class="summary-card"><div class="label">Total cost — quality routing</div><div class="value">$${totals.quality.toFixed(4)}</div></div>
    <div class="summary-card highlight"><div class="label">Savings with budget routing</div><div class="value">${savingsPct !== null ? savingsPct.toFixed(0) + '%' : '—'}</div></div>
  </div>
  <table>
    <thead><tr><th>Prompt</th><th class="budget">routing_preference: budget</th><th class="quality">routing_preference: quality</th></tr></thead>
    <tbody>${rowsHtml.join('')}</tbody>
  </table>
</div>
<footer>Model and cost data are read directly from each Inference Router response plus a local DigitalOcean pricing table. Costs are estimates for this demo only.</footer>
</body></html>`;
}

const PORT = parseInt(process.env.PORT, 10) || 8080;
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const MODEL_ACCESS_KEY = process.env.MODEL_ACCESS_KEY || null;

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(landingPage({ dryRun: DRY_RUN, hasKey: !!MODEL_ACCESS_KEY }));
      return;
    }

    if (req.url === '/run' && req.method === 'GET') {
      if (!DRY_RUN && !MODEL_ACCESS_KEY) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('MODEL_ACCESS_KEY is not configured and DRY_RUN is not true. Set one of them in the app\'s environment variables.');
        return;
      }
      const results = await runComparison({ modelAccessKey: MODEL_ACCESS_KEY, dryRun: DRY_RUN, baseUrl: BASE_URL });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(reportPage(results, { dryRun: DRY_RUN }));
      return;
    }

    if (req.url === '/run-custom' && req.method === 'POST') {
      if (!DRY_RUN && !MODEL_ACCESS_KEY) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('MODEL_ACCESS_KEY is not configured and DRY_RUN is not true. Set one of them in the app\'s environment variables.');
        return;
      }

      let body;
      try {
        body = await readRequestBody(req);
      } catch (err) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Request body too large.');
        return;
      }

      const params = new URLSearchParams(body);
      const promptText = (params.get('prompt') || '').trim();

      if (!promptText) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(landingPage({ dryRun: DRY_RUN, hasKey: !!MODEL_ACCESS_KEY, error: 'Enter a prompt before running the comparison.' }));
        return;
      }
      if (promptText.length > MAX_CUSTOM_PROMPT_LEN) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(landingPage({ dryRun: DRY_RUN, hasKey: !!MODEL_ACCESS_KEY, error: `Prompt is too long (max ${MAX_CUSTOM_PROMPT_LEN.toLocaleString()} characters).` }));
        return;
      }

      const customPrompt = { label: 'Your prompt', complexity: 'custom', text: promptText };
      // Pick a mock-model index from the text so dry-run results vary a bit
      // instead of always hitting the same two mock models.
      const mockIndex = promptText.length % MOCK_BUDGET_MODELS.length;
      const row = await runSinglePromptComparison(customPrompt, mockIndex, { modelAccessKey: MODEL_ACCESS_KEY, dryRun: DRY_RUN, baseUrl: BASE_URL });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(reportPage([row], {
        dryRun: DRY_RUN,
        title: 'Your Prompt — Results',
        subtitle: 'DigitalOcean Inference Router — budget vs quality routing_preference for the prompt you entered',
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('Unhandled error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error — check app logs.');
  }
});

server.listen(PORT, () => {
  console.log(`Cost-aware routing demo listening on :${PORT} (DRY_RUN=${DRY_RUN}, key configured=${!!MODEL_ACCESS_KEY})`);
});

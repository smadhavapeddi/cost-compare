#!/usr/bin/env node
/**
 * Cost-Aware Routing Demo — DigitalOcean Serverless Inference (Node.js)
 *
 * Sends the same set of prompts (simple -> complex) to DigitalOcean's
 * Inference Router twice per prompt: once with routing_preference=budget
 * and once with routing_preference=quality. For each call it records which
 * underlying model served the request, the token usage, and the estimated
 * cost, then prints a side-by-side comparison and writes an HTML report.
 *
 * No external dependencies — requires Node.js 18+ for the built-in fetch.
 *
 * Usage:
 *   export MODEL_ACCESS_KEY=sk-...
 *   node demo.js                       # run live against your DO account
 *   node demo.js --dry-run             # exercise the full pipeline with
 *                                      # canned responses, no API calls,
 *                                      # no key required
 *   node demo.js --out my_report.html  # change the HTML report path
 *
 * Get a model access key: DigitalOcean Control Panel -> Inference ->
 * Model Access Keys -> Create Model Access Key.
 */

'use strict';

const fs = require('fs');

const BASE_URL = 'https://inference.do-ai.run';
const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

// ---------------------------------------------------------------------------
// Per-model pricing (USD per 1M tokens), taken from DigitalOcean's published
// Inference pricing page. Only used to turn token usage into a dollar
// estimate for this demo's report — DO bills you directly for actual usage.
// Update this table if DO's pricing changes or the router picks a model not
// listed here (those show up in the report as "price unknown").
// ---------------------------------------------------------------------------
const PRICING_PER_MILLION_TOKENS = {
  // OpenAI
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
  // DeepSeek
  'deepseek-v4.1-flash': [0.30, 1.20],
  'deepseek-v4.1-flash-1017': [0.30, 1.20],
  'deepseek-v4-pro': [1.74, 3.48],
  'deepseek-v4-pro-0813': [1.32, 3.96],
  'deepseek-4-flash': [0.14, 0.28],
  'deepseek-v4-flash-0731': [0.14, 0.28],
  'deepseek-3.2': [0.50, 1.60],
  // Moonshot AI
  'kimi-k3': [3.00, 15.00],
  'kimi-k2.6': [0.95, 4.00],
  // Z.ai
  'glm-5.3': [1.40, 4.40],
  'glm-5.3-flash': [0.15, 0.50],
  'glm-5.2': [1.40, 4.40],
  // Xiaomi
  'mimo-v2.5-pro': [0.80, 3.00],
  // Alibaba
  'qwen3.8-max': [2.00, 6.00],
  'qwen3.5-397b-a17b': [0.55, 3.50],
  // Meta
  'llama-4-maverick': [0.25, 0.87],
  // Mistral
  'mistral-3-14B': [0.20, 0.20],
  // NVIDIA
  'nemotron-3.5-super-vl': [0.30, 0.65],
  'nemotron-3-ultra-550b': [0.90, 1.70],
  'nemotron-3-nano-omni': [0.50, 0.90],
  'nemotron-nano-12b-v2-vl': [0.20, 0.60],
  // Reflection AI
  'reflection-beam': [0.40, 1.20],
  // MiniMax
  'minimax-m3.1-flash': [0.15, 0.60],
  'minimax-m2.5': [0.30, 1.20],
  // Google
  'gemma-4-31B-it': [0.18, 0.50],
  // Arcee
  'arcee-trinity-large-thinking': [0.25, 0.90],
  // Anthropic (standard tier, <= context threshold where tiered)
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

// ---------------------------------------------------------------------------
// Demo prompts: a deliberate mix of trivial and genuinely hard questions, so
// the router's choices make a visible point. Feel free to edit this list —
// swap in prompts from your own product for an even more relevant pitch.
// ---------------------------------------------------------------------------
const PROMPTS = [
  {
    label: 'Simple factual lookup',
    complexity: 'simple',
    text: 'What is the capital of France?',
  },
  {
    label: 'Simple unit conversion',
    complexity: 'simple',
    text: 'Convert 100 degrees Fahrenheit to Celsius.',
  },
  {
    label: 'Simple copywriting',
    complexity: 'simple',
    text: 'Write a one-sentence tagline for a neighborhood coffee shop.',
  },
  {
    label: 'Simple formatting task',
    complexity: 'simple',
    text: 'Reformat this list into alphabetical order: banana, apple, cherry, date.',
  },
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${modelAccessKey}`,
      },
      body: JSON.stringify({
        model: 'inference-router',
        routing_preference: routingPreference,
        messages: [{ role: 'user', content: promptText }],
      }),
    });
  } catch (err) {
    return {
      model: null, input_tokens: 0, output_tokens: 0,
      latency_s: (Date.now() - start) / 1000, content: '',
      error: `Request failed: ${err.message}`,
    };
  }

  const latency_s = (Date.now() - start) / 1000;

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    return {
      model: null, input_tokens: 0, output_tokens: 0,
      latency_s, content: '',
      error: `HTTP ${res.status}: ${errBody.slice(0, 300)}`,
    };
  }

  const data = await res.json();
  const usage = data.usage || {};
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

  return {
    model: data.model,
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    latency_s,
    content: content.slice(0, 220),
    error: null,
  };
}

function estimateCostUsd(model, inputTokens, outputTokens) {
  const pricing = PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) return null;
  const [inRate, outRate] = pricing;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}

// ---------------------------------------------------------------------------
// Dry-run mock data, so the whole pipeline (incl. HTML report) can be
// exercised with no network access and no API key.
// ---------------------------------------------------------------------------
const MOCK_BUDGET_MODELS = [
  'openai-gpt-oss-20b', 'deepseek-4-flash', 'glm-5.3-flash', 'openai-gpt-oss-20b',
  'deepseek-v4-pro', 'kimi-k3', 'anthropic-claude-5-sonnet', 'deepseek-v4-pro',
];
const MOCK_QUALITY_MODELS = [
  'openai-gpt-oss-120b', 'deepseek-4-flash', 'glm-5.3-flash', 'openai-gpt-oss-120b',
  'anthropic-claude-opus-5', 'kimi-k3', 'anthropic-claude-opus-5.5', 'anthropic-claude-opus-5',
];

function callInferenceRouterMock(promptIndex, routingPreference) {
  const models = routingPreference === 'budget' ? MOCK_BUDGET_MODELS : MOCK_QUALITY_MODELS;
  const model = models[promptIndex % models.length];
  const inTok = 40 + promptIndex * 15;
  const outTok = 60 + promptIndex * 40;
  return {
    model,
    input_tokens: inTok,
    output_tokens: outTok,
    latency_s: 0.6 + 0.05 * promptIndex,
    content: '[dry-run mock response]',
    error: null,
  };
}

async function run(modelAccessKey, { dryRun, baseUrl }) {
  const results = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    const row = { prompt, runs: {} };
    for (const pref of ROUTING_PREFERENCES) {
      const r = dryRun
        ? callInferenceRouterMock(i, pref)
        : await callInferenceRouter(modelAccessKey, prompt.text, pref, baseUrl);
      r.cost_usd = r.error === null ? estimateCostUsd(r.model, r.input_tokens, r.output_tokens) : null;
      row.runs[pref] = r;

      const costStr = r.cost_usd !== null ? `, $${r.cost_usd.toFixed(6)})` : ')';
      console.log(
        `  [${prompt.complexity.padEnd(7)}] ${pref.padEnd(7)} -> ` +
        `${(r.model || 'ERROR').padEnd(32)} ` +
        `(${r.input_tokens}in/${r.output_tokens}out, ` +
        `${r.latency_s.toFixed(2)}s` + costStr
      );
    }
    results.push(row);
  }
  return results;
}

function printSummary(results) {
  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY');
  console.log('='.repeat(72));

  const totals = { budget: 0, quality: 0 };
  let unknownCost = false;
  for (const row of results) {
    for (const pref of ROUTING_PREFERENCES) {
      const cost = row.runs[pref].cost_usd;
      if (cost === null) unknownCost = true;
      else totals[pref] += cost;
    }
  }

  console.log(`Total estimated cost across ${results.length} prompts:`);
  console.log(`  budget preference:  $${totals.budget.toFixed(6)}`);
  console.log(`  quality preference: $${totals.quality.toFixed(6)}`);
  if (totals.quality > 0) {
    const savingsPct = (1 - totals.budget / totals.quality) * 100;
    console.log(`  -> budget routing cost ${savingsPct.toFixed(1)}% less than quality routing`);
  }
  if (unknownCost) {
    console.log("  (some models aren't in this script's pricing table; see the HTML report)");
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlReport(results, outPath) {
  const totals = { budget: 0, quality: 0 };
  const rowsHtml = [];

  for (const row of results) {
    const p = row.prompt;
    const b = row.runs.budget;
    const q = row.runs.quality;
    if (b.cost_usd !== null) totals.budget += b.cost_usd;
    if (q.cost_usd !== null) totals.quality += q.cost_usd;

    const badgeClass = p.complexity === 'complex' ? 'complex' : 'simple';

    const cell = (r) => {
      if (r.error) {
        return `<div class="err">Error: ${escapeHtml(r.error)}</div>`;
      }
      const costStr = r.cost_usd !== null ? `$${r.cost_usd.toFixed(6)}` : '—';
      return (
        `<div class="model">${escapeHtml(r.model || '?')}</div>` +
        `<div class="meta">${r.input_tokens} in / ${r.output_tokens} out ` +
        `&middot; ${r.latency_s.toFixed(2)}s &middot; <strong>${costStr}</strong></div>`
      );
    };

    const truncatedText = p.text.length > 160 ? p.text.slice(0, 160) + '…' : p.text;

    rowsHtml.push(`
        <tr>
          <td class="prompt-cell">
            <span class="badge ${badgeClass}">${p.complexity}</span>
            <div class="prompt-label">${escapeHtml(p.label)}</div>
            <div class="prompt-text">${escapeHtml(truncatedText)}</div>
          </td>
          <td class="run-cell budget">${cell(b)}</td>
          <td class="run-cell quality">${cell(q)}</td>
        </tr>`);
  }

  let savingsPct = null;
  if (totals.quality > 0) {
    savingsPct = (1 - totals.budget / totals.quality) * 100;
  }

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Cost-Aware Routing Demo — DigitalOcean Inference Router</title>
<style>
  :root {
    --do-blue: #0069ff;
    --do-blue-dark: #0050c4;
    --ink: #111827;
    --muted: #6b7280;
    --border: #e5e7eb;
    --bg: #f7f8fa;
    --card: #ffffff;
    --budget-bg: #eafbf0;
    --budget-border: #bfe9cf;
    --quality-bg: #eef4ff;
    --quality-border: #cfe0ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--ink);
  }
  header {
    background: #03244d;
    color: #fff;
    padding: 24px 28px;
  }
  header h1 { margin: 0 0 4px 0; font-size: 19px; }
  header p { margin: 0; font-size: 13px; color: #9fb4d6; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 24px; }

  .summary {
    display: flex;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .summary-card {
    flex: 1;
    min-width: 200px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
  }
  .summary-card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; margin-bottom: 6px; }
  .summary-card .value { font-size: 26px; font-weight: 700; }
  .summary-card.highlight { background: linear-gradient(135deg, #eafbf0, #eef4ff); border-color: #bfe9cf; }
  .summary-card.highlight .value { color: #0a7d3c; }

  table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
  thead th {
    text-align: left;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .03em;
    color: var(--muted);
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  thead th.budget { background: var(--budget-bg); }
  thead th.quality { background: var(--quality-bg); }
  td { padding: 14px 16px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: none; }

  .prompt-cell { width: 34%; }
  .badge {
    display: inline-block;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    margin-bottom: 6px;
  }
  .badge.simple { background: #eafbf0; color: #0a7d3c; }
  .badge.complex { background: #fff1e6; color: #b45309; }
  .prompt-label { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .prompt-text { font-size: 12.5px; color: var(--muted); font-family: ui-monospace, monospace; white-space: pre-wrap; }

  .run-cell.budget { background: var(--budget-bg); }
  .run-cell.quality { background: var(--quality-bg); }
  .run-cell .model { font-weight: 700; font-size: 13.5px; margin-bottom: 4px; }
  .run-cell .meta { font-size: 12px; color: var(--muted); }
  .run-cell .err { color: #b91c1c; font-size: 12.5px; }

  footer { text-align: center; font-size: 11px; color: var(--muted); padding: 24px; }
</style>
</head>
<body>

<header>
  <h1>Cost-Aware Routing Demo</h1>
  <p>DigitalOcean Inference Router — <code>budget</code> vs <code>quality</code> routing preference, same prompts, generated ${generatedAt}</p>
</header>

<div class="wrap">

  <div class="summary">
    <div class="summary-card">
      <div class="label">Total cost — budget routing</div>
      <div class="value">$${totals.budget.toFixed(4)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total cost — quality routing</div>
      <div class="value">$${totals.quality.toFixed(4)}</div>
    </div>
    <div class="summary-card highlight">
      <div class="label">Savings with budget routing</div>
      <div class="value">${savingsPct !== null ? savingsPct.toFixed(0) + '%' : '—'}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Prompt</th>
        <th class="budget">routing_preference: budget</th>
        <th class="quality">routing_preference: quality</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml.join('')}
    </tbody>
  </table>

</div>

<footer>
  Model and cost data are read directly from each Inference Router response
  (the <code>model</code> field) and a local price table based on
  DigitalOcean's published Inference pricing. Costs are estimates for this
  demo only — DigitalOcean bills you directly for actual usage.
</footer>

</body>
</html>
`;

  fs.writeFileSync(outPath, html);
}

function parseArgs(argv) {
  const args = {
    modelAccessKey: process.env.MODEL_ACCESS_KEY || null,
    baseUrl: BASE_URL,
    out: 'cost_aware_routing_report.html',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model-access-key') args.modelAccessKey = argv[++i];
    else if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node demo.js [--model-access-key KEY] [--base-url URL] [--out PATH] [--dry-run]\n\n' +
        'Env var MODEL_ACCESS_KEY is used if --model-access-key is not passed.'
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dryRun && !args.modelAccessKey) {
    console.error(
      'Error: no model access key provided. Set MODEL_ACCESS_KEY or pass ' +
      '--model-access-key, or use --dry-run to test without one.'
    );
    process.exit(1);
  }

  if (typeof fetch !== 'function') {
    console.error('Error: global fetch is not available. Use Node.js 18 or newer.');
    process.exit(1);
  }

  const mode = args.dryRun ? 'DRY RUN (mock data, no API calls)' : `LIVE against ${args.baseUrl}`;
  console.log(`Cost-Aware Routing Demo — ${mode}`);
  console.log(`Running ${PROMPTS.length} prompts x 2 routing preferences (${PROMPTS.length * 2} requests)...\n`);

  const results = await run(args.modelAccessKey, { dryRun: args.dryRun, baseUrl: args.baseUrl });
  printSummary(results);
  buildHtmlReport(results, args.out);
  console.log(`\nHTML report written to: ${args.out}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

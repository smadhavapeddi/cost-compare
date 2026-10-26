# Cost-Aware Routing Demo — DigitalOcean Inference Router

A self-serve demo showing DigitalOcean's **Inference Router** automatically
sending simple questions to cheap models and hard questions to stronger
(pricier) models — with no model selection code on your side.

It runs the same 8 prompts (4 simple, 4 genuinely hard) through the router
twice: once with `routing_preference: budget` and once with `routing_preference:
quality`. For each call it records which model actually served the request,
the token usage, and the cost, then prints a comparison and writes a
polished HTML report.

Available in two identical, dependency-free versions — pick whichever fits
the room you're demoing in:

- **`demo.py`** — Python 3, standard library only.
- **`demo.js`** — Node.js 18+, standard library + built-in `fetch` only.

Both produce byte-for-byte the same console output and HTML report (verified
against each other in dry-run mode).

## Get a model access key

DigitalOcean Control Panel → **Inference** → **Model Access Keys** →
**Create Model Access Key**.

Serverless Inference is prepaid, so make sure the team has a positive
Inference & Agents balance (or promotional credits) before running this live.

## Run it

**Python:**

```bash
export MODEL_ACCESS_KEY=sk-...
python3 demo.py
```

**Node.js (18+):**

```bash
export MODEL_ACCESS_KEY=sk-...
node demo.js
```

Either one sends 16 real requests (8 prompts × 2 preferences) to
`https://inference.do-ai.run/v1/chat/completions` and writes
`cost_aware_routing_report.html` in the current directory. Open that file
in a browser — that's the pitch-ready artifact.

### Try it without a key first

```bash
python3 demo.py --dry-run
# or
node demo.js --dry-run
```

Runs the full pipeline (console output + HTML report) against canned mock
data, so you can see exactly what the output looks like before spending
anything or getting a key. `sample_report_dry_run.html` in this folder is
exactly what that produces.

### Options (identical for both)

```
--model-access-key KEY   Same as MODEL_ACCESS_KEY env var
--base-url URL           Override the Inference API base URL
--out PATH               Where to write the HTML report (default:
                          cost_aware_routing_report.html)
--dry-run                Use mock data, no network calls, no key needed
```

## What to look for

- **Simple prompts** ("What's the capital of France?") should land on cheap,
  fast models under both preferences, often the *same* model regardless of
  preference — there's no reason to pay more for an easy question.
- **Complex prompts** (the concurrency bug, the proof, the systems design
  question, the incident triage) should show a visible split: `budget`
  leans toward strong-but-cheaper models, `quality` leans toward the
  strongest models available, usually at a real cost difference.
- The summary cards at the top of the HTML report show the total cost
  under each preference and the percentage saved by `budget` routing
  across this exact prompt set.

## Customizing for a specific prospect

Edit the `PROMPTS` list near the top of `demo.py` / `demo.js` — swap in real questions
from the prospect's own product (support tickets, code review requests,
whatever they actually send to an LLM today). The rest of the script needs
no changes; it reads the model and cost straight from each response.

## Notes

- Model IDs and per-model pricing are read from DigitalOcean's published
  Inference pricing page at the time this was built. If the router picks a
  model not in `PRICING_PER_MILLION_TOKENS`, the report shows the model and
  token counts but marks cost as unknown rather than guessing — update the
  table in `demo.py` (and the matching one in `demo.js`) if that happens.
- Routing itself is free during Inference Router's public preview; you're
  billed only for the model that serves each request.
- This hits the real API directly from wherever you run the script (your
  laptop, a Droplet, CI) — there's no server component and no browser CORS
  concerns to worry about.

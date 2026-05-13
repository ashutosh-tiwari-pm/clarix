# Clarix — AI Growth Engine for E-commerce

> **Turn customer data into revenue. In 8 minutes.**

A full-stack AI-powered Customer Data Platform (CDP) built for e-commerce growth teams. Upload your customer and transaction data — Clarix segments, analyses, and generates campaign playbooks across 6 parallel AI modules. No data science team required.

🔗 **[Try it live →](https://clarix-nine.vercel.app)** · [Sample data →](https://clarix-nine.vercel.app/sample-data/customers.csv)

---

## The Problem

E-commerce teams sit on goldmines of customer data — but extracting actionable intelligence requires expensive tools (Segment, Braze, Klaviyo), data science teams, and weeks of setup. Small and mid-size teams either fly blind or pay enterprise prices.

**Clarix compresses weeks of analysis into 8 minutes — for any team.**

---

## What It Does

### Mode A — Upload Your Data
Drop in your CSV files. Clarix parses, normalises, and runs 6 AI analyses in parallel.

| Module | What You Get |
|--------|-------------|
| 🎯 **Segments** | RFM-scored customer segments: Champions, Loyalists, Potential, At Risk, Lost — with recommended actions per segment |
| 📈 **Upsell Engine** | Ranked upsell opportunities with customer counts, revenue estimates, email subject lines and push copy |
| 🔗 **Cross-sell Intelligence** | Product affinity pairs from basket analysis, category gaps per segment |
| 🛡️ **Churn & Retention** | At-risk customer identification, revenue at stake, win-back campaign briefs |
| ⭐ **Loyalty Intelligence** | Tier ROI, near-upgrade candidates, discount cannibalization risk analysis |
| 📣 **Campaign Playbooks** | Complete email, push, and paid social briefs per segment — ready to hand to your team |

### Mode B — Brand Research
No data? No problem. Enter a brand name and industry — Claude generates a complete growth intelligence report using AI knowledge of the brand and market.

---

## Customer Intelligence Hub

Beyond analysis, Clarix includes a full **CDP-grade Personas module** — available immediately after uploading customers.csv, no AI key needed.

### Identity Resolution
Configure your own match rules using whatever fields exist in your CSV. Clarix compares every customer pair using:
- **Exact matching** — phone, email, national ID
- **Fuzzy matching** — names with typos (Levenshtein distance)
- **Prefix matching** — phone area codes, postal codes

Set confidence thresholds, review matches, merge duplicates, or export a suppression list.

### Household Graph
Cluster customers who likely live together — same surname + pincode, shared delivery address, phone prefix — using a Union-Find clustering algorithm. Each household card shows:
- All members with overlapping avatars
- **"Grouped because they share:"** — exact match parameters shown
- Best contact selection (highest loyalty tier)
- Marketing cost savings per household
- Export suppression list per household or in bulk

### Customer Profiles
Searchable, sortable profile cards for every customer. Click any card to open a premium profile popup with:
- Dark gradient hero with lifetime value, orders, avg order, days since last purchase
- Smart field formatting (loyalty points, opt-in status, churn risk calculated automatically)
- Two-column layout: Profile (left) + Behaviour (right)
- **Social Intelligence** — click "Research this customer online" and Claude infers lifestyle tags, life stage, trigger events, and best channels from demographic data

---

## AI Chart Assistant

The Overview tab ships with 6 default charts (revenue trend, segment donut, top products, geographic breakdown, acquisition channels, payment methods) — plus a conversational chart builder:

```
User: "Show revenue by acquisition channel for Gold customers only"
        ↓
AI: Assesses feasibility with your available data
        ↓
Possible → renders Chart.js chart instantly
Impossible → explains why + suggests alternative
```

Also generates 5 proactive chart suggestions after each analysis based on what's interesting in your specific data.

---

## Data Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Client)                   │
│                                                      │
│  Papa Parse → CSV Engine → RFM Engine → Stats       │
│  (100% client-side — raw data never leaves browser)  │
│                          ↓                           │
│           Summary statistics only                    │
└──────────────────────────┬──────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │    Vercel Edge (API)     │
              │    /api/claude.js        │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │   Anthropic Claude API   │
              │   6 parallel calls       │
              │   claude-haiku-4-5       │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │       Supabase           │
              │  analyses · insights     │
              │  customer_profiles       │
              │  raw_customers/txns      │
              │  households              │
              └─────────────────────────┘
```

**Privacy by design:** Raw CSV data is parsed entirely in the browser. Only statistical summaries (segment counts, revenue totals, top products) are sent to Claude. Users choose whether to save raw data to their account or keep it session-only.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Charts | Chart.js 4.4 |
| CSV Parsing | Papa Parse 5 (client-side) |
| Auth & DB | Supabase (PostgreSQL + Row Level Security) |
| AI | Anthropic Claude (claude-haiku-4-5) |
| Deployment | Vercel (serverless functions) |
| Fonts | Cabinet Grotesk + Plus Jakarta Sans |

---

## Database Schema

```sql
analyses          -- one per session (data upload or brand research)
insights          -- JSONB per module per analysis (6 rows per analysis)
customer_profiles -- computed profiles with spend/orders/tags
raw_customers     -- raw CSV rows (if user selects "Save to account")
raw_transactions  -- raw transaction rows
raw_products      -- raw product rows
raw_lineitems     -- raw line item rows
uploaded_datasets -- metadata per saved CSV file
households        -- household clusters from graph algorithm
clarix_user_profiles -- user settings, avatar, company, role
```

---

## Sample Data

Download 4 sample CSVs to try Clarix without your own data:

| File | Rows | Key Fields |
|------|------|-----------|
| [customers.csv](sample-data/customers.csv) | 40 | customer_id, email, loyalty_tier, city, signup_date |
| [transactions.csv](sample-data/transactions.csv) | 94 | transaction_id, customer_id, date, amount, channel |
| [products.csv](sample-data/products.csv) | 30 | product_id, category, brand, selling_price |
| [line_items.csv](sample-data/line_items.csv) | 224 | transaction_id, product_id, quantity, unit_price |

The data is designed to produce rich AI insights — Champions (CUST031, CUST003), At Risk customers, strong basket pairs (running shoes + socks, yoga set + water bottle), and clear upsell paths from casual to premium footwear.

---

## Setup

### Prerequisites
- [Supabase](https://supabase.com) account (free tier)
- [Anthropic API key](https://console.anthropic.com) (claude-haiku, ~$0.05–0.15 per analysis)
- [Vercel](https://vercel.com) account (free tier)

### Deploy in 5 minutes

```bash
# 1. Clone
git clone https://github.com/ashutosh-tiwari-pm/clarix.git
cd clarix

# 2. Configure Supabase credentials
# Edit js/supabase-client.js:
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

# 3. Run schema in Supabase SQL Editor
# Paste contents of supabase/schema-add-to-implify.sql
# Then paste: supabase/schema-profiles.sql
# Then paste: supabase/schema-raw-data.sql

# 4. Push to GitHub → connect to Vercel → Deploy
git add . && git commit -m "Configure" && git push
```

### Supabase Auth Setup
- Authentication → Sign In / Providers → Email → **Confirm email: OFF** (for frictionless demo)
- Authentication → URL Configuration → Site URL: `https://your-app.vercel.app`

---

## Features in Detail

### CSV Normalisation Engine
The client-side CSV engine handles 100+ column name variations automatically:

```javascript
// All of these map to the same standard field:
'cust_id', 'customerid', 'customer_no', 'uid', 'user_id' → customer_id
'order_date', 'purchase_date', 'created_at', 'ordered_at' → transaction_date
'total', 'order_total', 'grand_total', 'revenue'         → total_amount
```

Normalises dates (any format → ISO 8601), currencies (₹/$, commas), gender values, payment methods, and acquisition channels.

### RFM Scoring
Every customer is scored 1–5 on Recency, Frequency, and Monetary value. Composite scores determine segment assignment:

```
Score 13–15 → Champions    (bought recently, buy often, spend most)
Score 10–12 → Loyalists    (regular, high value)
Score  7–9  → Potential    (recent but low frequency)
Score  4–6  → At Risk      (haven't bought in a while)
Score  1–3  → Lost         (long since last purchase)
```

### Identity Resolution Algorithm
Configurable weighted scoring across selected fields:

```
Score = Σ (field_weight × match_result) / Σ total_weights

Example:
  phone (weight 38) × exact match (1.0) = 38.0
  surname (weight 25) × fuzzy match (0.87) = 21.75
  pincode (weight 20) × exact match (1.0) = 20.0
  ─────────────────────────────────────────────
  Total: 79.75 / 83 = 96% confidence → MATCH
```

---

## Product Thinking

Clarix was built to demonstrate end-to-end AI Product Management thinking:

**Problem framing:** CDPs (Segment, mParticle) cost $50K–$500K/year. SMEs and growth-stage teams need the same intelligence without enterprise contracts.

**Build vs buy decisions:** Papa Parse for client-side CSV (privacy), Supabase for auth + storage (RLS, instant setup), Claude Haiku for cost-effective parallel inference.

**AI-specific design:** Only statistical summaries sent to Claude — not raw PII. Parallel API calls (Promise.allSettled) reduce total analysis time from 48s sequential to ~8s parallel. Structured JSON outputs enable reliable rendering across all 6 modules.

**Data privacy:** Three-tier data model — session-only (default), saved to account (user choice), or deleted (granular per-dataset control). Matches GDPR data minimisation principles.

---

## What This Demonstrates

This project was built as a portfolio piece to demonstrate AI Product Management skills:

- **AI product strategy** — Identifying the right use case, user segment, and build approach
- **Technical depth** — Client-side data processing, async parallel AI calls, RLS database design
- **AI-specific UX** — Feasibility checkers, confidence scores, privacy notices, graceful degradation
- **Product thinking** — Privacy by design, data storage choices, cost transparency ($0.05/analysis)
- **Execution** — Working product, live URL, real data, real AI outputs

---

## Author

**Ashutosh Tiwari** — AI Product Manager

[LinkedIn](https://linkedin.com/in/ashutosh-tiwari) · [Implify (Project 1)](https://ai-implementation-manager.vercel.app) · [Clarix (Project 2)](https://clarix-nine.vercel.app)

---

*Built with Claude AI · Deployed on Vercel · Powered by Supabase*

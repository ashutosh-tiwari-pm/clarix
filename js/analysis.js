// ============================================================
// Clarix Analysis Orchestrator
// Handles: file upload UI, drag-drop, validation messages,
// Claude API calls per module, result rendering
// ============================================================

let session = null;
let analysisId = null;
let currentMode = 'data';
let isRunning = false;
const params = new URLSearchParams(location.search);

async function init() {
  session = await requireAuth();
  if (!session) return;

  if (params.get('id')) {
    analysisId = params.get('id');
    await loadExistingAnalysis();
  }
}

// ── MODE ──
function setMode(mode) {
  currentMode = mode;
  document.getElementById('tab-data').classList.toggle('active', mode === 'data');
  document.getElementById('tab-research').classList.toggle('active', mode === 'research');
  document.getElementById('data-mode-panel').style.display = mode === 'data' ? 'block' : 'none';
  document.getElementById('research-mode-panel').style.display = mode === 'research' ? 'block' : 'none';
}

// ── FILE HANDLING ──
async function handleFile(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  await loadFileToEngine(type, file);
}

async function handleDrop(event, type) {
  event.preventDefault();
  dragLeave(`uz-${type}`);
  const file = event.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) await loadFileToEngine(type, file);
}

function dragOver(event, zoneId) {
  event.preventDefault();
  document.getElementById(zoneId)?.classList.add('drag-over');
}

function dragLeave(zoneId) {
  document.getElementById(zoneId)?.classList.remove('drag-over');
}

async function loadFileToEngine(type, file) {
  try {
    const info = await ClarixEngine.loadFile(type, file);
    const zone = document.getElementById(`uz-${type}`);
    const nameEl = document.getElementById(`fn-${type}`);
    zone?.classList.add('has-file');
    if (nameEl) nameEl.textContent = `${file.name} · ${info.rows.toLocaleString()} rows`;
    updateRunButton();
    // Unlock Personas tab as soon as customers.csv is loaded
    if (type === 'customers' && window.initPersonasTab) initPersonasTab();
  } catch (e) {
    alert(`Error parsing ${file.name}: ${e.message}`);
  }
}

function removeFile(event, type) {
  event.stopPropagation();
  event.preventDefault();
  ClarixEngine.getRaw()[type] = null;
  const zone = document.getElementById(`uz-${type}`);
  zone?.classList.remove('has-file');
  const input = zone?.querySelector('input[type=file]');
  if (input) input.value = '';
  updateRunButton();
}

function updateRunButton() {
  const canRun = ClarixEngine.canRun();
  document.getElementById('run-main').disabled = !canRun;
  document.getElementById('run-btn').disabled = !canRun;

  // Show what modules will be available
  if (canRun) {
    const mods = [];
    if (ClarixEngine.hasFile('customers') && ClarixEngine.hasFile('transactions')) mods.push('Segments', 'Churn', 'Campaigns');
    if (ClarixEngine.hasFile('lineitems')) mods.push('Upsell', 'Cross-sell');
    if (ClarixEngine.hasFile('customers')) mods.push('Loyalty');
    document.getElementById('modules-ready').textContent = `${mods.length} modules ready · ${mods.join(', ')}`;
  } else {
    document.getElementById('modules-ready').textContent = 'Upload customers.csv + transactions.csv to start';
  }
}

// ── TAB SWITCHING ──
function switchTab(btn) {
  if (btn.classList.contains('locked')) return;
  document.querySelectorAll('.mod-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const panel = btn.dataset.panel;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${panel}`)?.classList.add('active');
}

function unlockTabs(modules) {
  document.querySelectorAll('.mod-tab').forEach(t => {
    const p = t.dataset.panel;
    if (p === 'overview' || modules.includes(p)) t.classList.remove('locked');
  });
}

// ── TITLE SAVE ──
async function saveTitle() {
  if (!analysisId) return;
  const title = document.getElementById('proj-title').value.trim() || 'Untitled Analysis';
  await supabaseClient.from('analyses').update({ name: title }).eq('id', analysisId);
}

// ── RUN ANALYSIS ──
async function runAnalysis() {
  if (isRunning || !ClarixEngine.canRun()) return;
  const apiKey = localStorage.getItem('clarix_api_key');
  if (!apiKey) { alert('Please add your Claude API key in Settings first.'); return; }

  isRunning = true;
  setRunLoading(true);
  switchToProcesing();

  try {
    // Process CSVs
    updateProcStep(0, 'active');
    const { stats, transforms } = await ClarixEngine.processAll();
    showTransformReport(transforms);
    updateProcStep(0, 'done');

    // Create or update analysis record
    updateProcStep(1, 'active');
    const name = document.getElementById('proj-title').value || 'New Analysis';
    if (!analysisId) {
      const { data } = await supabaseClient.from('analyses').insert({
        user_id: session.user.id,
        name,
        mode: currentMode,
        data_summary: stats.forClaude,
        status: 'processing'
      }).select().single();
      analysisId = data.id;
      history.pushState({}, '', `?id=${analysisId}`);
    } else {
      await supabaseClient.from('analyses').update({ data_summary: stats.forClaude, status: 'processing' }).eq('id', analysisId);
    }
    updateProcStep(1, 'done');

    // Run AI modules in parallel
    updateProcStep(2, 'active');
    const modulesToRun = stats.forClaude.modules_available || ['segments','churn','campaigns'];
    const results = await runModules(modulesToRun, stats.forClaude, apiKey);
    updateProcStep(2, 'done');

    // Save results to Supabase
    updateProcStep(3, 'active');
    for (const [module, output] of Object.entries(results)) {
      await supabaseClient.from('insights').upsert({
        analysis_id: analysisId, module, output
      }, { onConflict: 'analysis_id,module' });
    }

    // Save customer profiles to DB
    await saveCustomerProfilesToDB(analysisId, stats.full);

    await supabaseClient.from('analyses').update({ status: 'complete' }).eq('id', analysisId);
    updateProcStep(3, 'done');

    // Render results
    renderAllResults(results, stats.forClaude);
    unlockTabs(modulesToRun);

    // Switch to overview
    document.getElementById('panel-overview').classList.add('active');
    document.getElementById('welcome-state').style.display = 'none';
    document.getElementById('overview-results').style.display = 'block';
    document.querySelector('[data-panel="overview"]')?.click();

  } catch (err) {
    console.error(err);
    alert(`Analysis failed: ${err.message}`);
    await supabaseClient.from('analyses').update({ status: 'error' }).eq('id', analysisId);
  } finally {
    isRunning = false;
    setRunLoading(false);
    document.getElementById('panel-overview').querySelector('.processing-panel')?.remove();
  }
}

// ── SAVE CUSTOMER PROFILES TO DB ──
async function saveCustomerProfilesToDB(analysisId, fullStats) {
  try {
    const parsed = ClarixEngine.getParsed();
    const raw = ClarixEngine.getRaw();
    const customers = parsed.customers || raw.customers || [];
    const txns = parsed.transactions || raw.transactions || [];
    if (!customers.length) return;

    const profiles = customers.map(c => {
      const computed = (window.ClarixIdentity)
        ? ClarixIdentity.buildCustomerProfile(c, txns)
        : { totalSpend:0, orderCount:0, avgOrder:0, daysSinceLast:null, preferredChannels:[], preferredPayments:[], deliveryCities:[] };
      const tags = [];
      if (computed.orderCount > 5) tags.push('repeat_buyer');
      if (computed.daysSinceLast !== null && computed.daysSinceLast <= 30) tags.push('recent');
      if (computed.daysSinceLast !== null && computed.daysSinceLast > 90 && computed.orderCount >= 2) tags.push('at_risk');
      if (computed.totalSpend > 500) tags.push('high_value');
      if (c.loyalty_tier === 'Platinum' || c.loyalty_tier === 'Gold') tags.push('loyalty_member');
      return {
        analysis_id: analysisId,
        user_id: session.user.id,
        customer_id: c.customer_id || c.email || ('C'+Math.random()),
        raw_data: c,
        computed: { totalSpend:computed.totalSpend, orderCount:computed.orderCount, avgOrder:computed.avgOrder, daysSinceLast:computed.daysSinceLast, preferredChannels:computed.preferredChannels, preferredPayments:computed.preferredPayments, deliveryCities:computed.deliveryCities },
        tags,
      };
    });

    const CHUNK = 50;
    for (let i = 0; i < profiles.length; i += CHUNK) {
      await supabaseClient.from('customer_profiles').upsert(profiles.slice(i,i+CHUNK), { onConflict: 'analysis_id,customer_id' });
    }
  } catch(e) { console.warn('Profile save skipped:', e.message); }
}

async function runModules(modules, stats, apiKey) {
  const results = {};
  await Promise.allSettled(modules.map(async module => {
    try {
      const output = await callClaude(module, stats, apiKey);
      results[module] = output;
    } catch (e) { results[module] = { error: e.message }; }
  }));
  return results;
}

async function callClaude(module, stats, apiKey) {
  const prompts = {
    segments: `You are an expert e-commerce analyst. Based on this customer data summary, provide a detailed customer segmentation analysis.\n\nData: ${JSON.stringify(stats)}\n\nProvide analysis in JSON with this structure:\n{"segments":[{"name":"Champions","count":number,"pct":number,"avg_order_value":number,"total_revenue":number,"days_since_last_purchase":"range","preferred_categories":["cat1"],"recommended_action":"specific action","why":"explanation"}],"key_insight":"one sentence insight","quick_wins":["action1","action2","action3"]}`,

    upsell: `You are an expert e-commerce growth analyst. Based on this data, identify the top upsell opportunities.\n\nData: ${JSON.stringify(stats)}\n\nProvide in JSON:\n{"opportunities":[{"rank":1,"from_product_type":"description","to_product_type":"description","eligible_customers":number,"revenue_potential":number,"conversion_rate_estimate":number,"email_subject":"subject line","push_copy":"push notification copy","why":"rationale"}],"total_upsell_potential":number,"key_insight":"insight"}`,

    crosssell: `You are an expert e-commerce analyst. Analyse cross-sell opportunities from this basket data.\n\nData: ${JSON.stringify(stats)}\n\nProvide in JSON:\n{"pairs":[{"product_a":"name","product_b":"name","confidence_score":number,"eligible_customers":number,"revenue_potential":number,"campaign_angle":"how to pitch"}],"category_gaps":[{"segment":"segment name","has_category":"category they buy","missing_category":"category they should buy","opportunity_size":number}],"key_insight":"insight"}`,

    churn: `You are an expert e-commerce retention analyst. Analyse churn risk from this data.\n\nData: ${JSON.stringify(stats)}\n\nProvide in JSON:\n{"churn_summary":{"at_risk_count":number,"revenue_at_stake":number,"primary_trigger":"explanation"},"win_back_campaigns":[{"segment":"segment","trigger":"what causes churn here","offer":"specific offer","email_subject":"subject","expected_recovery_rate":number,"revenue_potential":number}],"retention_tactics":["tactic1","tactic2","tactic3"],"key_insight":"insight"}`,

    loyalty: `You are an expert loyalty programme analyst. Analyse this loyalty data.\n\nData: ${JSON.stringify(stats)}\n\nProvide in JSON:\n{"tier_analysis":[{"tier":"tier name","customer_count":number,"revenue_contribution_pct":number,"avg_order_value":number,"insight":"what drives this tier"}],"near_upgrade_count":number,"near_upgrade_opportunity":number,"discount_cannibalization":{"risk_level":"low/medium/high","explanation":"explanation","recommendation":"what to do"},"recommendations":["rec1","rec2","rec3"],"key_insight":"insight"}`,

    campaigns: `You are an expert e-commerce campaign strategist. Create campaign playbooks for each customer segment.\n\nData: ${JSON.stringify(stats)}\n\nProvide in JSON:\n{"campaigns":[{"segment":"segment name","segment_size":number,"priority":"high/medium/low","email":{"subject":"subject line","preview_text":"preview","body_angle":"what angle to take","cta":"call to action","best_time":"day and time","expected_open_rate":number},"push":{"copy":"notification copy","trigger":"when to send","deep_link":"section of app","expected_ctr":number},"paid_social":{"audience_brief":"who to target","creative_angle":"what creative to run","offer":"offer details"},"estimated_revenue":number}],"top_priority_campaign":"campaign name","key_insight":"insight"}`
  };

  const prompt = prompts[module];
  if (!prompt) throw new Error(`Unknown module: ${module}`);

  const resp = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt + '\n\nRespond ONLY with valid JSON. No markdown, no explanation.' }]
    })
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'API error');
  const text = data.content[0].text.trim().replace(/^```json?\n?/,'').replace(/\n?```$/,'');
  return JSON.parse(text);
}

// ── PROCESSING UI ──
function switchToProcesing() {
  const overview = document.getElementById('panel-overview');
  const procHtml = `
    <div class="processing-panel">
      <div class="proc-ring"></div>
      <div class="proc-label">Running 6 analyses...</div>
      <div class="proc-sub">Your data never leaves your browser</div>
      <div class="processing-steps">
        <div class="proc-step pending" id="ps-0">
          <div class="proc-step-icon">⚙️</div>
          <div class="proc-step-text"><strong>Parsing & normalising data</strong>Date formats, currencies, field mapping</div>
        </div>
        <div class="proc-step pending" id="ps-1">
          <div class="proc-step-icon">💾</div>
          <div class="proc-step-text"><strong>Saving analysis</strong>Creating your project record</div>
        </div>
        <div class="proc-step pending" id="ps-2">
          <div class="proc-step-icon">🧠</div>
          <div class="proc-step-text"><strong>Running AI modules</strong>6 parallel Claude analyses</div>
        </div>
        <div class="proc-step pending" id="ps-3">
          <div class="proc-step-icon">✅</div>
          <div class="proc-step-text"><strong>Saving insights</strong>Storing your growth playbook</div>
        </div>
      </div>
    </div>`;
  document.getElementById('welcome-state').style.display = 'none';
  overview.insertAdjacentHTML('afterbegin', procHtml);
  document.querySelector('[data-panel="overview"]')?.click();
}

function updateProcStep(idx, state) {
  const el = document.getElementById(`ps-${idx}`);
  if (!el) return;
  el.className = `proc-step ${state}`;
  const icon = el.querySelector('.proc-step-icon');
  if (icon) {
    if (state === 'done') icon.textContent = '✅';
    else if (state === 'active') icon.textContent = ['⚙️','💾','🧠','💾'][idx];
  }
}

function setRunLoading(v) {
  const btn = document.getElementById('run-main');
  const sp = document.getElementById('run-spinner');
  const ic = document.getElementById('run-icon');
  const lb = document.getElementById('run-label');
  if (btn) btn.disabled = v;
  if (sp) sp.style.display = v ? 'block' : 'none';
  if (ic) ic.style.display = v ? 'none' : 'block';
  if (lb) lb.textContent = v ? 'Analysing...' : 'Run Analysis';

  const navBtn = document.getElementById('run-btn');
  if (navBtn) { navBtn.disabled = v; navBtn.textContent = v ? 'Analysing...' : '▶ Run Analysis'; }
}

// ── TRANSFORM REPORT ──
function showTransformReport(transforms) {
  if (!transforms || transforms.length === 0) return;
  const report = document.getElementById('transform-report');
  const items = document.getElementById('transform-items');
  if (!report || !items) return;
  items.innerHTML = transforms.map(t => `
    <div class="tr-item">
      <div class="tr-dot" style="background:var(--teal)"></div>
      ${escHtml(t.action)}
    </div>`).join('');
  report.classList.add('show');
}

// ── RENDER RESULTS ──
function renderAllResults(results, stats) {
  renderOverview(stats, results);
  if (results.segments) renderSegments(results.segments);
  if (results.upsell) renderUpsell(results.upsell);
  if (results.crosssell) renderCrossSell(results.crosssell);
  if (results.churn) renderChurn(results.churn);
  if (results.loyalty) renderLoyalty(results.loyalty);
  if (results.campaigns) renderCampaigns(results.campaigns);

  // Init chart assistant with stats
  setTimeout(() => {
    if (window.ClarixCharts) {
      ClarixCharts.init(stats);
      // Show suggestions
      const sw = document.getElementById('suggestions-wrap');
      if (sw) sw.style.display = 'block';
    }
  }, 400);
}

function renderOverview(stats, results) {
  document.getElementById('welcome-state').style.display = 'none';
  document.getElementById('overview-results').style.display = 'block';

  // KPI strip
  const kpi = document.getElementById('kpi-strip');
  if (kpi) {
    const repeatRate = stats.repeat_customer_rate || 0;
    kpi.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Total Revenue</div>
        <div class="kpi-val">$${stats.total_revenue ? (stats.total_revenue/1000).toFixed(1)+'k' : '0'}</div>
        <div class="kpi-sub">${(stats.transaction_count||0).toLocaleString()} orders</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Customers</div>
        <div class="kpi-val">${(stats.customer_count||0).toLocaleString()}</div>
        <div class="kpi-sub">${repeatRate}% repeat buyers</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Order Value</div>
        <div class="kpi-val">$${(stats.avg_order_value||0).toLocaleString()}</div>
        <div class="kpi-sub">Max $${(stats.max_order_value||0).toLocaleString()}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Churn Risk</div>
        <div class="kpi-val danger">${stats.churn_risk_count||0}</div>
        <div class="kpi-sub">$${((stats.churn_revenue_at_risk||0)/1000).toFixed(1)}k revenue at stake</div>
      </div>`;
  }

  // Top insight
  const insight = results.segments?.key_insight || results.campaigns?.key_insight || results.churn?.churn_summary?.primary_trigger || '';
  if (insight) {
    const ti = document.getElementById('top-insight');
    const tt = document.getElementById('top-insight-text');
    if (ti && tt) { ti.style.display = 'block'; tt.textContent = insight; }
  }

  // Segment cards
  const segs = results.segments?.segments || [];
  const segCards = document.getElementById('seg-cards');
  const segLabel = document.getElementById('seg-cards-label');
  if (segCards && segs.length > 0) {
    if (segLabel) segLabel.style.display = 'flex';
    const segColors = { Champions:'var(--teal)', Loyalists:'var(--blue)', 'Potential Loyalists':'var(--purple)', 'At Risk':'var(--amber)', Lost:'var(--red)', New:'var(--green)' };
    segCards.innerHTML = segs.slice(0,4).map(s => {
      const c = segColors[s.name] || 'var(--teal)';
      return `<div class="insight-card" style="padding:14px 16px;border-left:3px solid ${c}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <div style="font-size:.875rem;font-weight:600;color:var(--t1)">${escHtml(s.name)}</div>
          <div style="font-size:.75rem;font-weight:700;color:${c}">${s.count} customers</div>
        </div>
        <div style="font-size:.8125rem;color:var(--t2);line-height:1.5">${escHtml(s.recommended_action||'')}</div>
        ${s.avg_order_value ? `<div style="font-size:.6875rem;color:var(--t3);margin-top:5px">Avg order: $${s.avg_order_value.toLocaleString()}</div>` : ''}
      </div>`;
    }).join('');
  }
}

function renderSegments(data) {
  const el = document.getElementById('segments-content');
  if (!el || !data.segments) return;
  const colors = { Champions:'var(--teal)', Loyalists:'var(--blue)', 'Potential Loyalists':'var(--purple)', 'At Risk':'var(--amber)', Lost:'var(--red)', New:'var(--green)' };
  const maxCount = Math.max(...data.segments.map(s=>s.count));

  el.innerHTML = `
    <div class="insight-card" style="margin-bottom:20px;padding:16px 20px">
      <div style="font-size:.6875rem;font-weight:700;color:var(--teal);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Key Insight</div>
      <div style="font-size:.9375rem;color:var(--t1)">${escHtml(data.key_insight||'')}</div>
    </div>
    <div class="insight-card">
      <table class="seg-table" style="width:100%">
        <thead><tr>
          <th>Segment</th><th>Count</th><th>Size</th><th>Avg Order</th><th>Recommended Action</th>
        </tr></thead>
        <tbody>
          ${data.segments.map(s=>{
            const c = colors[s.name] || 'var(--teal)';
            const pct = Math.round((s.count/maxCount)*100);
            return `<tr>
              <td><div style="display:flex;align-items:center;gap:8px"><div style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></div>${escHtml(s.name)}</div></td>
              <td><div class="seg-count">${s.count?.toLocaleString()}</div></td>
              <td><div class="seg-bar-wrap"><div class="seg-bar-bg"><div class="seg-bar-f" style="width:${pct}%;background:${c}"></div></div><span style="font-size:.75rem;color:var(--t2);min-width:28px">${s.pct||''}%</span></div></td>
              <td>$${(s.avg_order_value||0).toLocaleString()}</td>
              <td><div class="action-tag">${escHtml(s.recommended_action||'')}</div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="insight-card" style="margin-top:14px">
      <div style="font-size:.75rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Quick Wins</div>
      ${(data.quick_wins||[]).map(w=>`<div style="display:flex;gap:8px;margin-bottom:8px;font-size:.875rem;color:var(--t2)"><span style="color:var(--teal)">→</span>${escHtml(w)}</div>`).join('')}
    </div>`;
}

function renderUpsell(data) {
  const el = document.getElementById('upsell-content');
  if (!el || !data.opportunities) return;
  el.innerHTML = `
    <div class="insight-card" style="margin-bottom:20px;padding:16px 20px">
      <div style="font-size:.6875rem;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Total Upsell Potential</div>
      <div style="font-family:var(--fd);font-weight:800;font-size:2rem;color:var(--t1)">$${((data.total_upsell_potential||0)/1000).toFixed(0)}k</div>
      <div style="font-size:.875rem;color:var(--t2);margin-top:4px">${escHtml(data.key_insight||'')}</div>
    </div>
    <div class="opp-list">
      ${data.opportunities.map((o,i)=>`
        <div class="opp-item">
          <div>
            <div class="opp-item-title">${escHtml(o.from_product_type)} → ${escHtml(o.to_product_type)}</div>
            <div class="opp-item-desc" style="margin-bottom:6px">${escHtml(o.why||'')}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <div style="font-size:.6875rem;background:rgba(245,158,11,.1);color:var(--amber);padding:3px 8px;border-radius:5px">Email: ${escHtml(o.email_subject||'')}</div>
              <div style="font-size:.6875rem;background:var(--s2);color:var(--t2);padding:3px 8px;border-radius:5px">Push: ${escHtml(o.push_copy||'')}</div>
            </div>
          </div>
          <div class="opp-value">
            <div class="opp-amount">$${((o.revenue_potential||0)/1000).toFixed(0)}k</div>
            <div class="opp-customers">${(o.eligible_customers||0).toLocaleString()} customers</div>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderCrossSell(data) {
  const el = document.getElementById('crosssell-content');
  if (!el) return;
  el.innerHTML = `
    <div class="insight-card" style="margin-bottom:20px;padding:16px 20px">
      <div style="font-size:.875rem;color:var(--t1)">${escHtml(data.key_insight||'')}</div>
    </div>
    ${(data.pairs||[]).map(p=>`
      <div class="insight-card" style="margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:.9375rem;font-weight:600;color:var(--t1)">${escHtml(p.product_a)} + ${escHtml(p.product_b)}</div>
          <div style="font-size:.75rem;background:var(--purple-faint);color:var(--purple);padding:3px 9px;border-radius:99px;font-weight:600">${Math.round((p.confidence_score||0)*100)}% confidence</div>
        </div>
        <div style="font-size:.8125rem;color:var(--t2);margin-bottom:8px">${escHtml(p.campaign_angle||'')}</div>
        <div style="display:flex;gap:16px">
          <div style="font-size:.8125rem;color:var(--t2)">${(p.eligible_customers||0).toLocaleString()} customers eligible</div>
          <div style="font-size:.8125rem;color:var(--teal);font-weight:600">$${((p.revenue_potential||0)/1000).toFixed(0)}k potential</div>
        </div>
      </div>`).join('')}
    ${(data.category_gaps||[]).length > 0 ? `
      <div class="insight-card" style="margin-top:16px">
        <div style="font-size:.75rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Category Gaps</div>
        ${data.category_gaps.map(g=>`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:.875rem">
            <span style="color:var(--teal)">→</span>
            <span style="color:var(--t2)">${escHtml(g.segment)}: Buys <strong style="color:var(--t1)">${escHtml(g.has_category)}</strong> but not <strong style="color:var(--amber)">${escHtml(g.missing_category)}</strong></span>
          </div>`).join('')}
      </div>` : ''}`;
}

function renderChurn(data) {
  const el = document.getElementById('churn-content');
  if (!el || !data.churn_summary) return;
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      <div class="insight-card" style="padding:16px;border-color:rgba(239,68,68,.2)">
        <div style="font-size:.75rem;color:var(--red);margin-bottom:4px">At-risk customers</div>
        <div style="font-family:var(--fd);font-weight:800;font-size:1.75rem;color:var(--t1)">${(data.churn_summary.at_risk_count||0).toLocaleString()}</div>
      </div>
      <div class="insight-card" style="padding:16px;border-color:rgba(239,68,68,.2)">
        <div style="font-size:.75rem;color:var(--red);margin-bottom:4px">Revenue at stake</div>
        <div style="font-family:var(--fd);font-weight:800;font-size:1.75rem;color:var(--t1)">$${((data.churn_summary.revenue_at_stake||0)/1000).toFixed(0)}k</div>
      </div>
    </div>
    <div class="insight-card" style="margin-bottom:16px;padding:14px 16px">
      <div style="font-size:.75rem;font-weight:700;color:var(--red);margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em">Primary Churn Trigger</div>
      <div style="font-size:.875rem;color:var(--t1)">${escHtml(data.churn_summary.primary_trigger||'')}</div>
    </div>
    ${(data.win_back_campaigns||[]).map(c=>`
      <div class="insight-card" style="margin-bottom:10px">
        <div style="font-size:.75rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">${escHtml(c.segment)}</div>
        <div style="font-size:.8125rem;color:var(--t2);margin-bottom:8px">${escHtml(c.trigger||'')}</div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px">
          <div style="font-size:.75rem;font-weight:600;color:var(--t3);margin-bottom:3px">Offer</div>
          <div style="font-size:.875rem;color:var(--t1)">${escHtml(c.offer||'')}</div>
          <div style="font-size:.75rem;color:var(--t2);margin-top:6px">Email: "${escHtml(c.email_subject||'')}"</div>
        </div>
        <div style="display:flex;gap:16px;font-size:.8125rem">
          <div style="color:var(--teal)">Est. recovery: ${c.expected_recovery_rate||0}%</div>
          <div style="color:var(--t2)">Revenue: $${((c.revenue_potential||0)/1000).toFixed(0)}k</div>
        </div>
      </div>`).join('')}`;
}

function renderLoyalty(data) {
  const el = document.getElementById('loyalty-content');
  if (!el) return;
  el.innerHTML = `
    ${(data.tier_analysis||[]).map(t=>`
      <div class="insight-card" style="margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:.9375rem;font-weight:600;color:var(--t1)">${escHtml(t.tier)}</div>
          <div style="font-size:.75rem;background:var(--green-faint);color:var(--green);padding:3px 9px;border-radius:99px;font-weight:600">${t.revenue_contribution_pct||0}% of revenue</div>
        </div>
        <div style="font-size:.8125rem;color:var(--t2);margin-bottom:6px">${escHtml(t.insight||'')}</div>
        <div style="display:flex;gap:16px;font-size:.8125rem;color:var(--t3)">
          <div>${(t.customer_count||0).toLocaleString()} customers</div>
          <div>Avg order: $${(t.avg_order_value||0).toLocaleString()}</div>
        </div>
      </div>`).join('')}
    ${data.near_upgrade_count ? `
      <div class="insight-card" style="margin-top:14px;padding:14px 16px;background:var(--teal-faint);border-color:rgba(0,212,180,.2)">
        <div style="font-size:.875rem;font-weight:600;color:var(--teal);margin-bottom:4px">${data.near_upgrade_count} customers near next tier upgrade</div>
        <div style="font-size:.8125rem;color:var(--t2)">Revenue opportunity: $${((data.near_upgrade_opportunity||0)/1000).toFixed(0)}k</div>
      </div>` : ''}
    ${data.discount_cannibalization ? `
      <div class="insight-card" style="margin-top:10px">
        <div style="font-size:.75rem;font-weight:700;color:var(--amber);margin-bottom:6px">Discount Cannibalization Risk: ${escHtml(data.discount_cannibalization.risk_level||'')}</div>
        <div style="font-size:.8125rem;color:var(--t2);margin-bottom:6px">${escHtml(data.discount_cannibalization.explanation||'')}</div>
        <div style="font-size:.8125rem;color:var(--t1)">${escHtml(data.discount_cannibalization.recommendation||'')}</div>
      </div>` : ''}`;
}

function renderCampaigns(data) {
  const el = document.getElementById('campaigns-content');
  if (!el || !data.campaigns) return;
  el.innerHTML = `
    <div class="insight-card" style="margin-bottom:20px;padding:14px 16px;background:var(--teal-faint);border-color:rgba(0,212,180,.2)">
      <div style="font-size:.75rem;font-weight:700;color:var(--teal);margin-bottom:4px">Top Priority Campaign</div>
      <div style="font-size:.9375rem;color:var(--t1)">${escHtml(data.top_priority_campaign||'')} · ${escHtml(data.key_insight||'')}</div>
    </div>
    ${data.campaigns.map(c=>`
      <div class="campaign-card">
        <div class="campaign-segment">${escHtml(c.segment)} · ${(c.segment_size||0).toLocaleString()} customers · Est. $${((c.estimated_revenue||0)/1000).toFixed(0)}k</div>
        ${c.email ? `
          <div class="campaign-channel">
            <div class="channel-icon" style="background:var(--blue-faint)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.75" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></div>
            <div class="channel-label">Email · ${c.email.best_time||''} · Est. open rate ${c.email.expected_open_rate||0}%</div>
          </div>
          <div class="campaign-content"><strong>${escHtml(c.email.subject||'')}</strong><br><span style="color:var(--t2);font-size:.8125rem">${escHtml(c.email.body_angle||'')} · CTA: ${escHtml(c.email.cta||'')}</span></div>` : ''}
        ${c.push ? `
          <div class="campaign-channel" style="margin-top:10px">
            <div class="channel-icon" style="background:var(--purple-faint)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A855F7" stroke-width="1.75" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
            <div class="channel-label">Push · Est. CTR ${c.push.expected_ctr||0}%</div>
          </div>
          <div class="campaign-content">${escHtml(c.push.copy||'')} · Trigger: ${escHtml(c.push.trigger||'')}</div>` : ''}
        ${c.paid_social ? `
          <div class="campaign-channel" style="margin-top:10px">
            <div class="channel-icon" style="background:var(--amber-faint)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.75" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></div>
            <div class="channel-label">Paid Social</div>
          </div>
          <div class="campaign-content">${escHtml(c.paid_social.audience_brief||'')} · ${escHtml(c.paid_social.offer||'')}</div>` : ''}
      </div>`).join('')}`;
}

// ── LOAD EXISTING ──
async function loadExistingAnalysis() {
  const { data: analysis } = await supabaseClient.from('analyses').select('*').eq('id', analysisId).single();
  if (!analysis) return;
  document.getElementById('proj-title').value = analysis.name;
  if (analysis.status === 'complete') {
    const { data: insights } = await supabaseClient.from('insights').select('*').eq('analysis_id', analysisId);
    if (insights) {
      const results = {};
      insights.forEach(i => { results[i.module] = i.output; });
      const modules = Object.keys(results);
      unlockTabs(modules);
      document.getElementById('welcome-state').style.display = 'none';
      document.getElementById('overview-results').style.display = 'block';
      renderAllResults(results, analysis.data_summary || {});
    }
  }
}

// ── RESEARCH MODE ──
async function runResearch() {
  const brand = document.getElementById('brand-name').value.trim();
  const industry = document.getElementById('brand-industry').value;
  if (!brand) { alert('Please enter a brand name'); return; }
  const apiKey = localStorage.getItem('clarix_api_key');
  if (!apiKey) { alert('Please add your Claude API key in Settings'); return; }

  // TODO: Implement brand research mode (Session 3)
  alert('Brand research mode coming in the next session!');
}

// ── UTILS ──
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();

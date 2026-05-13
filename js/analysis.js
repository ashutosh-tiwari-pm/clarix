// ============================================================
// Clarix Analysis Orchestrator
// Handles: file upload UI, drag-drop, validation messages,
// Claude API calls per module, result rendering
// ============================================================

let session = null;
let analysisId = null;
let currentMode = 'data';
let storageMode = 'session'; // 'session' | 'save'

// ── STORAGE MODE ──
async function setStorageMode(mode) {
  storageMode = mode;
  document.getElementById('storage-session')?.classList.toggle('active', mode === 'session');
  document.getElementById('storage-save')?.classList.toggle('active', mode === 'save');

  if (mode === 'save') {
    // Save immediately — don't wait for analysis
    await saveRawDataImmediately();
  }
}

function showStoragePanel() {
  const panel = document.getElementById('storage-mode-panel');
  if (panel) panel.style.display = 'block';
}

// ── IMMEDIATE SAVE (triggered on mode selection) ──
let _dataSaved = false; // track if already saved this session

async function saveRawDataImmediately() {
  if (_dataSaved) return; // already saved, skip

  const raw = ClarixEngine.getRaw();
  const parsed = ClarixEngine.getParsed();
  const hasData = raw.customers?.length || raw.transactions?.length;
  if (!hasData) {
    // No data yet — set a flag so it saves automatically when analysis creates the ID
    showStorageIndicator('pending', '💾 Will save when analysis runs...');
    return;
  }

  // Need an analysis ID first — create a draft record
  if (!analysisId) {
    const name = document.getElementById('proj-title')?.value || 'New Analysis';
    const { data } = await supabaseClient.from('analyses').insert({
      user_id: session.user.id,
      name,
      mode: currentMode,
      status: 'draft',
      data_summary: null,
    }).select().single();
    if (data) {
      analysisId = data.id;
      history.pushState({}, '', `?id=${analysisId}`);
    }
  }

  if (!analysisId) { showStorageIndicator('error', '⚠ Could not save — try again'); return; }

  await saveRawDataToDB(analysisId);
}

// ── SAVE RAW DATA TO DB ──
async function saveRawDataToDB(analysisId) {
  if (storageMode !== 'save') return;
  if (_dataSaved) return; // already saved

  const parsed = ClarixEngine.getParsed();
  const raw = ClarixEngine.getRaw();

  showStorageIndicator('saving', '↑ Saving data to account...');

  try {
    const filesToSave = [
      { type:'customers',    table:'raw_customers',    idField:'customer_id',    records: parsed.customers    || raw.customers    || [] },
      { type:'transactions', table:'raw_transactions', idField:'transaction_id', records: parsed.transactions || raw.transactions || [] },
      { type:'products',     table:'raw_products',     idField:'product_id',     records: parsed.products     || raw.products     || [] },
      { type:'lineitems',    table:'raw_lineitems',    idField:'transaction_id', records: parsed.lineitems    || raw.lineitems    || [] },
    ];

    for (const f of filesToSave) {
      if (!f.records.length) continue;

      // Metadata
      await supabaseClient.from('uploaded_datasets').upsert({
        analysis_id: analysisId,
        user_id: session.user.id,
        dataset_type: f.type,
        row_count: f.records.length,
        column_names: Object.keys(f.records[0] || {}),
        storage_mode: 'saved',
      }, { onConflict: 'analysis_id,dataset_type' });

      // Records in chunks of 100
      const CHUNK = 100;
      for (let i = 0; i < f.records.length; i += CHUNK) {
        const chunk = f.records.slice(i, i + CHUNK).map(r => ({
          analysis_id: analysisId,
          user_id: session.user.id,
          [f.idField]: r[f.idField] || null,
          ...(f.type === 'transactions' ? { customer_id: r.customer_id || null } : {}),
          ...(f.type === 'lineitems'    ? { product_id:  r.product_id  || null } : {}),
          record: r,
        }));
        await supabaseClient.from(f.table).upsert(chunk);
      }
    }

    _dataSaved = true;
    showStorageIndicator('saved', '✓ Data saved to account');
    setTimeout(() => hideStorageIndicator(), 4000);
  } catch (e) {
    console.warn('Data save failed:', e.message);
    showStorageIndicator('error', '⚠ Save failed — session only');
  }
}

function showStorageIndicator(type, msg) {
  const el = document.getElementById('storage-save-indicator');
  if (!el) return;
  const colors = { saving:'var(--teal)', saved:'var(--green)', error:'var(--amber)', pending:'var(--t2)' };
  el.style.display = 'flex';
  el.style.color = colors[type] || 'var(--teal)';
  el.textContent = msg;
}

function hideStorageIndicator() {
  const el = document.getElementById('storage-save-indicator');
  if (el) el.style.display = 'none';
}

// ── LOAD SAVED DATA FROM DB (for existing analysis) ──
async function loadSavedDataFromDB(analysisId) {
  try {
    const { data: datasets } = await supabaseClient
      .from('uploaded_datasets')
      .select('*')
      .eq('analysis_id', analysisId)
      .eq('storage_mode', 'saved');

    if (!datasets || datasets.length === 0) return false;

    // Show saved data banner in sidebar
    showSavedDataBanner(datasets);

    // Load each dataset back into memory
    const tableMap = { customers:'raw_customers', transactions:'raw_transactions', products:'raw_products', lineitems:'raw_lineitems' };

    for (const ds of datasets) {
      const table = tableMap[ds.dataset_type];
      if (!table) continue;

      const { data: records } = await supabaseClient
        .from(table)
        .select('record')
        .eq('analysis_id', analysisId)
        .order('created_at');

      if (records && records.length > 0) {
        const rows = records.map(r => r.record);
        // Load back into engine
        ClarixEngine.getRaw()[ds.dataset_type] = rows;

        // Update UI
        const zone = document.getElementById(`uz-${ds.dataset_type}`);
        const nameEl = document.getElementById(`fn-${ds.dataset_type}`);
        zone?.classList.add('has-file');
        if (nameEl) nameEl.textContent = `Saved · ${rows.length.toLocaleString()} rows`;
      }
    }

    updateRunButton();
    if (window.initPersonasTab) initPersonasTab();
    return true;
  } catch (e) {
    console.warn('Load saved data failed:', e.message);
    return false;
  }
}

function showSavedDataBanner(datasets) {
  const sidebar = document.getElementById('data-mode-panel');
  if (!sidebar || document.getElementById('saved-data-banner')) return;
  const total = datasets.reduce((s,d) => s+d.row_count, 0);
  const banner = document.createElement('div');
  banner.id = 'saved-data-banner';
  banner.style.cssText = 'background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:11px 13px;margin-bottom:10px';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
      <div style="font-size:.75rem;font-weight:700;color:var(--green)">✓ Data saved to account</div>
      <button onclick="openDataManager('${datasets[0]?.analysis_id}')" style="font-size:.625rem;font-weight:600;color:var(--teal);background:none;border:none;cursor:pointer;font-family:var(--fb)">Manage →</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${datasets.map(d => `<div style="display:flex;justify-content:space-between;font-size:.6875rem;color:var(--t2)">
        <span>${d.dataset_type}</span>
        <span style="color:var(--t1);font-weight:500">${d.row_count.toLocaleString()} rows</span>
      </div>`).join('')}
    </div>
    <div style="font-size:.625rem;color:var(--t3);margin-top:5px">Total: ${total.toLocaleString()} rows · <a href="#" onclick="openDataManager('${datasets[0]?.analysis_id}');return false;" style="color:var(--red);text-decoration:none">Delete data</a></div>`;
  sidebar.insertBefore(banner, sidebar.firstChild);
}

// ── DATA MANAGER MODAL ──
async function openDataManager(aid) {
  const analysisIdToUse = aid || analysisId;
  if (!analysisIdToUse) return;

  // Fetch current datasets
  const { data: datasets } = await supabaseClient
    .from('uploaded_datasets')
    .select('*')
    .eq('analysis_id', analysisIdToUse)
    .order('uploaded_at');

  // Build modal HTML
  const modal = document.getElementById('data-manager-modal');
  const body = document.getElementById('data-manager-body');
  if (!modal || !body) return;

  const total = (datasets||[]).reduce((s,d) => s+d.row_count, 0);
  const tableMap = {
    customers: { label:'Customers', icon:'👤', color:'#00D4B4', dbTable:'raw_customers' },
    transactions: { label:'Transactions', icon:'💳', color:'#F59E0B', dbTable:'raw_transactions' },
    products: { label:'Products', icon:'📦', color:'#A855F7', dbTable:'raw_products' },
    lineitems: { label:'Line Items', icon:'📋', color:'#3B82F6', dbTable:'raw_lineitems' },
  };

  if (!datasets || datasets.length === 0) {
    body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--t2);font-size:.875rem">No data saved to account for this analysis.<br><span style="color:var(--t3);font-size:.8125rem">Select "Save to my account" before running analysis.</span></div>`;
  } else {
    body.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:.6875rem;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Saved Datasets · ${total.toLocaleString()} total rows</div>
        ${datasets.map(d => {
          const meta = tableMap[d.dataset_type] || { label:d.dataset_type, icon:'📄', color:'#7A90B0', dbTable:'raw_'+d.dataset_type };
          return `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;margin-bottom:8px">
            <div style="width:36px;height:36px;border-radius:9px;background:${meta.color}22;display:flex;align-items:center;justify-content:center;font-size:1.125rem;flex-shrink:0">${meta.icon}</div>
            <div style="flex:1">
              <div style="font-size:.875rem;font-weight:600;color:var(--t1)">${meta.label}</div>
              <div style="font-size:.75rem;color:var(--t2)">${d.row_count.toLocaleString()} rows · saved ${new Date(d.uploaded_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
              <div style="font-size:.625rem;color:var(--t3);margin-top:2px">${(d.column_names||[]).slice(0,5).join(', ')}${(d.column_names||[]).length>5?'...':''}</div>
            </div>
            <button onclick="deleteDataset('${analysisIdToUse}','${d.dataset_type}','${meta.dbTable}',this)" style="padding:6px 12px;background:var(--red-faint);color:var(--red);border:1px solid rgba(239,68,68,.2);border-radius:7px;font-size:.6875rem;font-weight:600;cursor:pointer;font-family:var(--fb);white-space:nowrap">Delete</button>
          </div>`;
        }).join('')}
      </div>
      <div style="padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-size:.75rem;font-weight:600;color:var(--red);margin-bottom:6px">Delete all data for this analysis</div>
        <div style="font-size:.8125rem;color:var(--t2);margin-bottom:12px;line-height:1.5">Removes all saved datasets from your account. The analysis results and insights are kept — only the raw uploaded data is deleted.</div>
        <button onclick="deleteAllDatasets('${analysisIdToUse}')" style="display:flex;align-items:center;gap:6px;padding:9px 18px;background:var(--red-faint);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:9px;font-size:.875rem;font-weight:600;cursor:pointer;font-family:var(--fb)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          Delete all datasets
        </button>
      </div>`;
  }

  modal.classList.add('open');
}

function closeDataManager() {
  document.getElementById('data-manager-modal')?.classList.remove('open');
}

async function deleteDataset(analysisId, type, dbTable, btn) {
  if (!confirm(`Delete ${type} data? This cannot be undone.`)) return;
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  try {
    await supabaseClient.from(dbTable).delete().eq('analysis_id', analysisId);
    await supabaseClient.from('uploaded_datasets').delete()
      .eq('analysis_id', analysisId).eq('dataset_type', type);
    // Remove the card
    btn.closest('div[style*="display:flex;align-items:center"]').remove();
    // Update banner
    const banner = document.getElementById('saved-data-banner');
    if (banner) {
      // Refresh by reloading
      const { data } = await supabaseClient.from('uploaded_datasets').select('*').eq('analysis_id', analysisId);
      if (!data || data.length === 0) { banner.remove(); }
    }
    _dataSaved = false;
    showStorageIndicator('saved', `✓ ${type} data deleted`);
    setTimeout(() => hideStorageIndicator(), 3000);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Delete';
    showStorageIndicator('error', '⚠ Delete failed');
  }
}

async function deleteAllDatasets(analysisId) {
  if (!confirm('Delete ALL saved datasets for this analysis? Analysis results are kept.')) return;
  const tables = ['raw_customers','raw_transactions','raw_products','raw_lineitems','uploaded_datasets'];
  for (const t of tables) {
    await supabaseClient.from(t).delete().eq('analysis_id', analysisId);
  }
  document.getElementById('saved-data-banner')?.remove();
  _dataSaved = false;
  closeDataManager();
  showStorageIndicator('saved', '✓ All datasets deleted from account');
  setTimeout(() => hideStorageIndicator(), 3000);
}
let isRunning = false;
const params = new URLSearchParams(location.search);
const IS_DEMO = params.get('demo') === 'true';

async function init() {
  if (IS_DEMO) {
    await initDemoMode();
    return;
  }

  session = await requireAuth();
  if (!session) return;

  if (params.get('id')) {
    analysisId = params.get('id');
    await loadExistingAnalysis();
  }
}

// ── CLARIX DEMO MODE ──
async function initDemoMode() {
  // Fake session for UI
  session = { user: { id: 'demo', email: 'demo@clarix.app' } };

  // Demo banner
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#0F766E,#0891B2);color:#fff;padding:9px 24px;display:flex;align-items:center;justify-content:space-between;font-size:.875rem;font-family:system-ui,sans-serif';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <span style="background:rgba(255,255,255,.2);padding:2px 10px;border-radius:99px;font-size:.75rem;font-weight:700;letter-spacing:.05em">DEMO</span>
      <span style="opacity:.9">Live demo — 40 customers · 94 transactions · 30 products — pre-loaded sample data</span>
    </div>
    <a href="/login.html?mode=signup" style="background:#fff;color:#0F766E;padding:6px 16px;border-radius:7px;font-weight:700;text-decoration:none;font-size:.8125rem">Create free account →</a>`;
  document.body.prepend(banner);
  document.body.style.paddingTop = '44px';

  showStoragePanel();

  // Auto-load all 4 sample CSVs
  const files = ['customers', 'transactions', 'products', 'lineitems'];
  const fileNames = {
    customers: 'sample-data/customers.csv',
    transactions: 'sample-data/transactions.csv',
    products: 'sample-data/products.csv',
    lineitems: 'sample-data/line_items.csv'
  };

  for (const type of files) {
    try {
      const resp = await fetch(fileNames[type]);
      const text = await resp.text();
      const blob = new Blob([text], { type: 'text/csv' });
      const file = new File([blob], type + '.csv', { type: 'text/csv' });
      await loadFileToEngine(type, file);
    } catch(e) {
      console.warn('Demo file load failed:', type, e.message);
    }
  }

  updateRunButton();
  showStoragePanel();

  // Show demo hint
  const modulesReady = document.getElementById('modules-ready');
  if (modulesReady) {
    modulesReady.textContent = '✓ Sample data loaded — add your API key and click Run Analysis';
    modulesReady.style.color = 'var(--teal)';
  }

  // If API key exists, auto-run after short delay
  const existingKey = localStorage.getItem('clarix_api_key');
  if (existingKey) {
    setTimeout(() => runAnalysis(), 1000);
  } else {
    setTimeout(() => {
      const key = prompt('To see AI analysis results, enter your Claude API key:\n(Free at console.anthropic.com)\n\nOr Cancel to browse the demo UI.');
      if (key && key.startsWith('sk-')) {
        localStorage.setItem('clarix_api_key', key);
        setTimeout(() => runAnalysis(), 300);
      }
    }, 600);
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
    // Show storage mode panel on first file
    showStoragePanel();
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
  _dataSaved = false; // reset so new data can be saved
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

    // Save raw data if not already saved (safety net — primary trigger is on mode selection)
    if (!_dataSaved) await saveRawDataToDB(analysisId);

    if (!IS_DEMO) await supabaseClient.from('analyses').update({ status: 'complete' }).eq('id', analysisId);
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
    if (!IS_DEMO) await supabaseClient.from('analyses').update({ status: 'error' }).eq('id', analysisId);
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

  // Try to load saved raw data from DB first
  await loadSavedDataFromDB(analysisId);

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
// ── BRAND RESEARCH MODE ──
async function runResearch() {
  const brand = document.getElementById('brand-name').value.trim();
  const url = document.getElementById('brand-url')?.value.trim() || '';
  const industry = document.getElementById('brand-industry').value;
  if (!brand) { showResearchError('Please enter a brand name'); return; }
  if (!industry) { showResearchError('Please select an industry'); return; }
  const apiKey = localStorage.getItem('clarix_api_key');
  if (!apiKey) { showResearchError('Please add your Claude API key in Settings first'); return; }

  isRunning = true;
  setResearchLoading(true);

  // Create analysis record
  try {
    const name = `${brand} — Brand Research`;
    if (!analysisId) {
      const { data } = await supabaseClient.from('analyses').insert({
        user_id: session.user.id,
        name,
        mode: 'research',
        brand_name: brand,
        brand_url: url,
        industry,
        status: 'processing',
      }).select().single();
      if (data) {
        analysisId = data.id;
        history.pushState({}, '', `?id=${analysisId}`);
        document.getElementById('proj-title').value = name;
      }
    }

    // Switch to overview and show processing state
    switchResearchProcessing(brand);

    // Run all 6 research modules in parallel
    const modules = ['segments','upsell','crosssell','churn','loyalty','campaigns'];
    const results = await runBrandResearchModules(brand, industry, url, apiKey);

    // Save insights
    for (const [module, output] of Object.entries(results)) {
      await supabaseClient.from('insights').upsert({
        analysis_id: analysisId, module, output
      }, { onConflict: 'analysis_id,module' });
    }

    // Build a mock stats object for the overview
    const mockStats = {
      brand_name: brand,
      industry,
      customer_count: null,
      transaction_count: null,
      total_revenue: null,
      is_research_mode: true,
    };

    await supabaseClient.from('analyses').update({
      status: 'complete',
      data_summary: mockStats,
    }).eq('id', analysisId);

    // Render results
    renderResearchResults(results, brand, industry);
    unlockTabs(modules);
    document.querySelector('[data-panel="overview"]')?.click();

  } catch(err) {
    console.error(err);
    showResearchError('Research failed: ' + err.message);
    if (analysisId) await supabaseClient.from('analyses').update({ status:'error' }).eq('id', analysisId);
  } finally {
    isRunning = false;
    setResearchLoading(false);
    document.getElementById('panel-overview').querySelector('.processing-panel')?.remove();
  }
}

async function runBrandResearchModules(brand, industry, url, apiKey) {
  const context = `Brand: ${brand}\nIndustry: ${industry}\n${url ? 'Website: '+url : ''}`;

  const prompts = {
    segments: `You are a senior market analyst. Research and analyse the customer segments for ${brand} in the ${industry} industry.

${context}

Based on your knowledge of this brand and industry, provide detailed customer segmentation.
Respond ONLY with valid JSON:
{"segments":[{"name":"Segment Name","count":estimated_number,"pct":percentage,"avg_order_value":estimated_aov,"total_revenue":estimated_revenue,"days_since_last_purchase":"range description","preferred_categories":["category"],"recommended_action":"specific action","why":"rationale"}],"key_insight":"one sharp insight about this brand's customer base","quick_wins":["actionable win 1","actionable win 2","actionable win 3"]}`,

    upsell: `You are a growth strategist analysing ${brand} in the ${industry} industry.

${context}

Identify the top upsell opportunities for this brand based on typical customer behaviour in this sector.
Respond ONLY with valid JSON:
{"opportunities":[{"rank":1,"from_product_type":"entry product","to_product_type":"premium product","eligible_customers":estimated_count,"revenue_potential":estimated_value,"conversion_rate_estimate":percentage,"email_subject":"compelling subject line","push_copy":"push notification copy","why":"rationale"}],"total_upsell_potential":estimated_total,"key_insight":"sharp upsell insight"}`,

    crosssell: `You are a retail analytics expert analysing ${brand} in ${industry}.

${context}

Identify cross-sell opportunities and product affinity pairs typical for this brand/industry.
Respond ONLY with valid JSON:
{"pairs":[{"product_a":"product type","product_b":"complementary product","confidence_score":0.0_to_1.0,"eligible_customers":estimated_count,"revenue_potential":estimated_value,"campaign_angle":"how to pitch this pair"}],"category_gaps":[{"segment":"segment name","has_category":"category they buy","missing_category":"category they should buy","opportunity_size":estimated_value}],"key_insight":"cross-sell insight"}`,

    churn: `You are a retention specialist analysing ${brand} in ${industry}.

${context}

Based on industry benchmarks and this brand's positioning, analyse churn risk and win-back opportunities.
Respond ONLY with valid JSON:
{"churn_summary":{"at_risk_count":estimated_count,"revenue_at_stake":estimated_value,"primary_trigger":"main churn driver for this type of brand"},"win_back_campaigns":[{"segment":"segment","trigger":"churn trigger","offer":"specific win-back offer","email_subject":"subject line","expected_recovery_rate":percentage,"revenue_potential":estimated_value}],"retention_tactics":["tactic 1","tactic 2","tactic 3"],"key_insight":"retention insight"}`,

    loyalty: `You are a loyalty programme strategist analysing ${brand} in ${industry}.

${context}

Analyse the loyalty landscape and programme opportunities for this brand.
Respond ONLY with valid JSON:
{"tier_analysis":[{"tier":"tier name","customer_count":estimated_count,"revenue_contribution_pct":percentage,"avg_order_value":estimated_aov,"insight":"what drives this tier"}],"near_upgrade_count":estimated_count,"near_upgrade_opportunity":estimated_value,"discount_cannibalization":{"risk_level":"low/medium/high","explanation":"explanation","recommendation":"recommendation"},"recommendations":["rec 1","rec 2","rec 3"],"key_insight":"loyalty insight"}`,

    campaigns: `You are a campaign strategist analysing ${brand} in ${industry}.

${context}

Create campaign playbooks tailored to this brand's customer segments and positioning.
Respond ONLY with valid JSON:
{"campaigns":[{"segment":"segment name","segment_size":estimated_size,"priority":"high/medium/low","email":{"subject":"compelling subject","preview_text":"preview","body_angle":"angle","cta":"call to action","best_time":"optimal send time","expected_open_rate":percentage},"push":{"copy":"notification copy","trigger":"trigger event","deep_link":"section","expected_ctr":percentage},"paid_social":{"audience_brief":"targeting brief","creative_angle":"creative direction","offer":"offer details"},"estimated_revenue":estimated_value}],"top_priority_campaign":"campaign name","key_insight":"campaign insight"}`,
  };

  const results = {};
  await Promise.allSettled(Object.entries(prompts).map(async ([module, prompt]) => {
    try {
      const resp = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt + '\n\nRespond ONLY with valid JSON. No markdown, no explanation, no preamble.' }]
        })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content[0].text.trim();
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      results[module] = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch(e) {
      results[module] = { error: e.message };
    }
  }));
  return results;
}

function switchResearchProcessing(brand) {
  const overview = document.getElementById('panel-overview');
  overview.innerHTML = `
    <div class="processing-panel">
      <div class="proc-ring"></div>
      <div class="proc-label">Researching ${escHtml(brand)}...</div>
      <div class="proc-sub">Claude is analysing this brand across 6 growth dimensions</div>
      <div class="processing-steps">
        <div class="proc-step active" id="ps-research">
          <div class="proc-step-icon">🔍</div>
          <div class="proc-step-text"><strong>Running 6 parallel analyses</strong>Segments · Upsell · Cross-sell · Churn · Loyalty · Campaigns</div>
        </div>
      </div>
    </div>`;
  document.getElementById('welcome-state') && (document.getElementById('welcome-state').style.display = 'none');
  document.querySelector('[data-panel="overview"]')?.click();
}

function renderResearchResults(results, brand, industry) {
  // Build a research-mode overview
  const overview = document.getElementById('panel-overview');
  const insight = results.segments?.key_insight || results.campaigns?.key_insight || `Brand intelligence report for ${brand} complete.`;

  overview.innerHTML = `
    <div class="kpi-strip" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
      <div class="kpi-card" style="grid-column:1/-1;background:linear-gradient(135deg,var(--s1),var(--s2));border-color:rgba(0,212,180,.2)">
        <div class="kpi-label" style="color:var(--teal)">Brand Intelligence Report</div>
        <div class="kpi-val" style="font-size:1.25rem">${escHtml(brand)}</div>
        <div class="kpi-sub">${escHtml(industry)} · AI-powered market analysis</div>
      </div>
    </div>
    <div class="top-insight" style="display:block">
      <div class="top-insight-label">✦ Key Insight</div>
      <div class="top-insight-text">${escHtml(insight)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
      ${(results.segments?.segments || results.segments?.quick_wins ? `
        <div class="insight-card" style="padding:14px 16px;border-left:3px solid var(--teal)">
          <div style="font-size:.75rem;font-weight:700;color:var(--teal);margin-bottom:6px">Customer Segments</div>
          <div style="font-size:.8125rem;color:var(--t2)">${(results.segments?.segments||[]).slice(0,2).map(s=>`<div style="margin-bottom:4px">→ <strong style="color:var(--t1)">${escHtml(s.name)}</strong>: ${escHtml(s.recommended_action||'')}</div>`).join('')}</div>
        </div>` : '')}
      ${(results.campaigns?.top_priority_campaign ? `
        <div class="insight-card" style="padding:14px 16px;border-left:3px solid var(--blue)">
          <div style="font-size:.75rem;font-weight:700;color:var(--blue);margin-bottom:6px">Top Priority Campaign</div>
          <div style="font-size:.8125rem;color:var(--t1)">${escHtml(results.campaigns.top_priority_campaign)}</div>
          <div style="font-size:.75rem;color:var(--t2);margin-top:4px">${escHtml(results.campaigns.key_insight||'')}</div>
        </div>` : '')}
      ${(results.churn?.churn_summary ? `
        <div class="insight-card" style="padding:14px 16px;border-left:3px solid var(--red)">
          <div style="font-size:.75rem;font-weight:700;color:var(--red);margin-bottom:6px">Churn Risk</div>
          <div style="font-size:.8125rem;color:var(--t1)">${escHtml(results.churn.churn_summary.primary_trigger||'')}</div>
        </div>` : '')}
      ${(results.upsell?.key_insight ? `
        <div class="insight-card" style="padding:14px 16px;border-left:3px solid var(--amber)">
          <div style="font-size:.75rem;font-weight:700;color:var(--amber);margin-bottom:6px">Upsell Opportunity</div>
          <div style="font-size:.8125rem;color:var(--t1)">${escHtml(results.upsell.key_insight||'')}</div>
        </div>` : '')}
    </div>`;

  // Render all module tabs (reuses existing render functions)
  if (results.segments) renderSegments(results.segments);
  if (results.upsell) renderUpsell(results.upsell);
  if (results.crosssell) renderCrossSell(results.crosssell);
  if (results.churn) renderChurn(results.churn);
  if (results.loyalty) renderLoyalty(results.loyalty);
  if (results.campaigns) renderCampaigns(results.campaigns);
}

function setResearchLoading(v) {
  const btn = document.querySelector('#research-mode-panel .run-btn');
  if (!btn) return;
  btn.disabled = v;
  btn.innerHTML = v
    ? '<div class="spinner" style="display:block;width:14px;height:14px;border:2px solid rgba(6,11,18,.3);border-top-color:#060B12;border-radius:50%;animation:spin .6s linear infinite"></div> Researching...'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Research Brand';
}

function showResearchError(msg) {
  const existing = document.getElementById('research-error-msg');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'research-error-msg';
  el.style.cssText = 'background:var(--red-faint);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px 12px;font-size:.8125rem;color:var(--red);margin-top:8px';
  el.textContent = msg;
  document.querySelector('#research-mode-panel .run-btn')?.after(el);
  setTimeout(() => el.remove(), 5000);
}

// ── UTILS ──
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();

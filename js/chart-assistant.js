// ============================================================
// Clarix AI Chart Assistant
// Conversational chart builder with feasibility checking
// and proactive suggestions based on available data
// ============================================================

window.ClarixCharts = (() => {

  // Track rendered custom charts
  let _customCharts = [];
  let _stats = null;
  let _suggestions = [];
  let _chartInstances = {}; // Chart.js instances by canvas id

  // Default Chart.js dark theme
  const THEME = {
    teal:    '#00D4B4',
    amber:   '#F59E0B',
    purple:  '#A855F7',
    red:     '#EF4444',
    green:   '#22C55E',
    blue:    '#3B82F6',
    t1:      '#EDF2FF',
    t2:      '#7A90B0',
    t3:      '#4A6080',
    border:  'rgba(255,255,255,0.06)',
    bg:      '#060B12',
    s1:      '#0D1520',
    s2:      '#111C2C',
  };

  Chart.defaults.color = THEME.t2;
  Chart.defaults.borderColor = THEME.border;
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";

  // ── INIT ──
  function init(stats) {
    _stats = stats;
    _customCharts = [];
    renderDefaultCharts(stats);
    generateSuggestions(stats);
  }

  // ── DEFAULT CHARTS (always rendered) ──
  function renderDefaultCharts(stats) {
    const container = document.getElementById('default-charts');
    if (!container) return;
    container.innerHTML = '';

    const charts = [];

    // 1. Monthly revenue trend
    if (stats.monthly_revenue && stats.monthly_revenue.length > 2) {
      charts.push(buildRevenueChart(stats.monthly_revenue));
    }

    // 2. Customer segment donut
    if (stats.segments) {
      charts.push(buildSegmentChart(stats.segments));
    }

    // 3. Top products by revenue
    if (stats.top_products_by_revenue && stats.top_products_by_revenue.length > 0) {
      charts.push(buildTopProductsChart(stats.top_products_by_revenue));
    }

    // 4. Geographic breakdown
    if (stats.top_cities && stats.top_cities.length > 0) {
      charts.push(buildGeoChart(stats.top_cities));
    }

    // 5. Acquisition channels
    if (stats.acquisition_channels && Object.keys(stats.acquisition_channels).length > 1) {
      charts.push(buildChannelChart(stats.acquisition_channels));
    }

    // 6. Payment methods
    if (stats.payment_methods && Object.keys(stats.payment_methods).length > 1) {
      charts.push(buildPaymentChart(stats.payment_methods));
    }

    charts.forEach(chart => {
      const wrapper = document.createElement('div');
      wrapper.className = 'chart-card';
      wrapper.innerHTML = `
        <div class="chart-card-header">
          <div class="chart-card-title">${chart.title}</div>
          <div class="chart-card-sub">${chart.subtitle || ''}</div>
        </div>
        <div class="chart-card-body">
          <canvas id="${chart.id}" height="${chart.height || 200}"></canvas>
        </div>`;
      container.appendChild(wrapper);
      setTimeout(() => renderChart(chart), 50);
    });
  }

  function buildRevenueChart(monthly) {
    const labels = monthly.map(m => {
      const [y, mo] = m.month.split('-');
      return new Date(y, mo-1).toLocaleString('default', { month: 'short', year: '2-digit' });
    });
    const data = monthly.map(m => m.revenue);
    return {
      id: 'chart-revenue-trend',
      title: 'Monthly Revenue Trend',
      subtitle: `Last ${monthly.length} months`,
      height: 200,
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenue ($)',
          data,
          backgroundColor: data.map((v, i) => i === data.length-1 ? THEME.teal : 'rgba(0,212,180,0.3)'),
          borderColor: THEME.teal,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `$${c.raw.toLocaleString()}` }}},
        scales: {
          x: { grid: { color: THEME.border }, ticks: { color: THEME.t3, font: { size: 10 }}},
          y: { grid: { color: THEME.border }, ticks: { color: THEME.t3, font: { size: 10 }, callback: v => `$${(v/1000).toFixed(0)}k` }}
        }
      }
    };
  }

  function buildSegmentChart(segments) {
    const names = Object.keys(segments).map(k => k.charAt(0).toUpperCase() + k.slice(1));
    const counts = Object.values(segments).map(s => s.count);
    const colors = [THEME.teal, THEME.blue, THEME.amber, THEME.red, THEME.t3];
    return {
      id: 'chart-segments',
      title: 'Customer Segments',
      subtitle: 'RFM-based distribution',
      height: 220,
      type: 'doughnut',
      data: {
        labels: names,
        datasets: [{
          data: counts,
          backgroundColor: colors.map(c => c + 'CC'),
          borderColor: colors,
          borderWidth: 1.5,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        cutout: '68%',
        plugins: {
          legend: { position: 'right', labels: { color: THEME.t2, font: { size: 11 }, padding: 12, boxWidth: 12 }},
          tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} customers` }}
        }
      }
    };
  }

  function buildTopProductsChart(products) {
    const top8 = products.slice(0, 8);
    return {
      id: 'chart-top-products',
      title: 'Top Products by Revenue',
      subtitle: 'Based on line item data',
      height: 220,
      type: 'bar',
      data: {
        labels: top8.map(p => p.name.length > 20 ? p.name.slice(0,18)+'…' : p.name),
        datasets: [{
          label: 'Revenue ($)',
          data: top8.map(p => p.revenue),
          backgroundColor: THEME.amber + 'AA',
          borderColor: THEME.amber,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `$${c.raw.toLocaleString()}` }}},
        scales: {
          x: { grid: { color: THEME.border }, ticks: { color: THEME.t3, font: { size: 10 }, callback: v => `$${v.toLocaleString()}` }},
          y: { grid: { display: false }, ticks: { color: THEME.t2, font: { size: 10 }}}
        }
      }
    };
  }

  function buildGeoChart(cities) {
    const top7 = cities.slice(0, 7);
    return {
      id: 'chart-geo',
      title: 'Top Cities by Customer Count',
      subtitle: 'Geographic distribution',
      height: 200,
      type: 'bar',
      data: {
        labels: top7.map(c => c.name),
        datasets: [{
          label: 'Customers',
          data: top7.map(c => c.count),
          backgroundColor: THEME.purple + 'AA',
          borderColor: THEME.purple,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }},
        scales: {
          x: { grid: { display: false }, ticks: { color: THEME.t3, font: { size: 10 }}},
          y: { grid: { color: THEME.border }, ticks: { color: THEME.t3, font: { size: 10 }}}
        }
      }
    };
  }

  function buildChannelChart(channels) {
    const entries = Object.entries(channels).sort((a,b) => b[1]-a[1]);
    const colors = [THEME.teal, THEME.blue, THEME.purple, THEME.amber, THEME.green, THEME.red];
    return {
      id: 'chart-channels',
      title: 'Acquisition Channels',
      subtitle: 'How customers found you',
      height: 200,
      type: 'doughnut',
      data: {
        labels: entries.map(([k]) => k.replace(/_/g,' ')),
        datasets: [{
          data: entries.map(([,v]) => v),
          backgroundColor: colors.map(c => c + 'CC'),
          borderColor: colors,
          borderWidth: 1.5,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { color: THEME.t2, font: { size: 11 }, padding: 10, boxWidth: 12 }}
        }
      }
    };
  }

  function buildPaymentChart(methods) {
    const entries = Object.entries(methods).sort((a,b) => b[1]-a[1]);
    const colors = [THEME.green, THEME.teal, THEME.blue, THEME.amber, THEME.purple];
    return {
      id: 'chart-payment',
      title: 'Payment Methods',
      subtitle: 'Transaction breakdown',
      height: 200,
      type: 'doughnut',
      data: {
        labels: entries.map(([k]) => k.replace(/_/g,' ')),
        datasets: [{
          data: entries.map(([,v]) => v),
          backgroundColor: colors.map(c => c + 'CC'),
          borderColor: colors,
          borderWidth: 1.5,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { color: THEME.t2, font: { size: 11 }, padding: 10, boxWidth: 12 }}
        }
      }
    };
  }

  function renderChart(config) {
    const canvas = document.getElementById(config.id);
    if (!canvas) return;
    if (_chartInstances[config.id]) { _chartInstances[config.id].destroy(); }
    _chartInstances[config.id] = new Chart(canvas, {
      type: config.type,
      data: config.data,
      options: { ...config.options, animation: { duration: 800, easing: 'easeInOutQuart' }}
    });
  }

  // ── AI SUGGESTIONS ──
  function generateSuggestions(stats) {
    const s = [];

    if (stats.segments) {
      const atRisk = stats.segments.at_risk || {};
      if (atRisk.count > 0) {
        s.push({ text: `Revenue at risk: ${atRisk.count} at-risk customers hold $${atRisk.total?.toLocaleString()} in potential value`, query: 'Show revenue concentration by customer segment' });
      }
    }

    if (stats.monthly_revenue && stats.monthly_revenue.length > 3) {
      const revenues = stats.monthly_revenue.map(m => m.revenue);
      const maxMonth = stats.monthly_revenue[revenues.indexOf(Math.max(...revenues))];
      if (maxMonth) s.push({ text: `Peak month: ${maxMonth.month} was your strongest at $${maxMonth.revenue.toLocaleString()}`, query: 'Show monthly revenue trend with growth rate' });
    }

    if (stats.top_products_by_revenue && stats.top_products_by_revenue.length > 0) {
      const top = stats.top_products_by_revenue[0];
      s.push({ text: `Top product: "${top.name}" drives the most revenue — see full product ranking`, query: 'Show top 10 products by revenue as a ranked bar chart' });
    }

    if (stats.repeat_customer_rate) {
      s.push({ text: `${stats.repeat_customer_rate}% of customers are repeat buyers — explore loyalty patterns`, query: 'Show repeat vs one-time customer breakdown' });
    }

    if (stats.churn_risk_count > 0) {
      s.push({ text: `${stats.churn_risk_count} customers at churn risk — visualise by segment`, query: 'Show churn risk distribution by customer segment' });
    }

    if (stats.top_basket_pairs && stats.top_basket_pairs.length > 0) {
      s.push({ text: `Top basket pair: "${stats.top_basket_pairs[0].product_a}" + "${stats.top_basket_pairs[0].product_b}" bought together ${stats.top_basket_pairs[0].co_occurrence_count} times`, query: 'Show top product affinity pairs as a chart' });
    }

    _suggestions = s.slice(0, 5);
    renderSuggestions();
  }

  function renderSuggestions() {
    const el = document.getElementById('chart-suggestions');
    if (!el || _suggestions.length === 0) return;
    el.innerHTML = _suggestions.map(s => `
      <div class="suggestion-pill" onclick="ClarixCharts.askChart('${escJs(s.query)}')">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        ${s.text}
      </div>`).join('');
  }

  // ── AI CHART ASSISTANT ──
  async function askChart(query) {
    if (!query || !_stats) return;
    const apiKey = localStorage.getItem('clarix_api_key');
    if (!apiKey) { showChatMessage('error', 'Please add your Claude API key in Settings to use the AI chart assistant.'); return; }

    // Set input value if called from suggestion
    const input = document.getElementById('chart-query-input');
    if (input && query) input.value = query;

    showChatMessage('loading', 'Assessing your data and building chart...');

    // Build data availability context
    const dataContext = buildDataContext(_stats);

    const prompt = `You are an AI chart assistant for an e-commerce analytics platform called Clarix.

The user wants to see: "${query}"

Available data summary:
${JSON.stringify(dataContext, null, 2)}

Your job:
1. Assess if this chart is POSSIBLE, PARTIAL, or IMPOSSIBLE with the available data
2. If POSSIBLE or PARTIAL: return a Chart.js configuration JSON
3. If IMPOSSIBLE: explain why and suggest an alternative

Respond with JSON only in this exact structure:
{
  "feasibility": "possible" | "partial" | "impossible",
  "explanation": "one sentence explaining what you can/cannot do",
  "alternative": "if impossible, what you can show instead (or null)",
  "chart": {
    "type": "bar" | "doughnut" | "line" | "pie",
    "title": "chart title",
    "subtitle": "one line description",
    "data": { Chart.js data object },
    "options": { Chart.js options - minimal, no callbacks }
  } | null
}

Important rules:
- Only use data that EXISTS in the data summary above
- For colors use: #00D4B4 (teal), #F59E0B (amber), #A855F7 (purple), #EF4444 (red), #22C55E (green), #3B82F6 (blue)
- Keep labels short (max 20 chars)
- Return null for chart if impossible
- No JavaScript functions in options (no callbacks) - keep options serializable JSON`;

    try {
      const resp = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt + '\n\nRespond ONLY with valid JSON.' }]
        })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content[0].text.trim().replace(/^```json?\n?/,'').replace(/\n?```$/,'');
      const result = JSON.parse(text);
      handleChartResponse(result, query);
    } catch(e) {
      showChatMessage('error', `Failed to generate chart: ${e.message}`);
    }
  }

  function handleChartResponse(result, query) {
    const container = document.getElementById('custom-charts');
    if (!container) return;

    if (result.feasibility === 'impossible') {
      showChatMessage('impossible', result.explanation, result.alternative);
      return;
    }

    if (result.feasibility === 'partial') {
      showChatMessage('partial', result.explanation);
    } else {
      hideChatMessage();
    }

    if (!result.chart) return;

    const chartId = 'custom-chart-' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-card chart-card-custom';
    wrapper.dataset.query = query;
    wrapper.innerHTML = `
      <div class="chart-card-header">
        <div>
          <div class="chart-card-title">${result.chart.title}</div>
          <div class="chart-card-sub">${result.chart.subtitle || ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="chart-ai-badge">✦ AI Generated</div>
          <button class="chart-remove-btn" onclick="ClarixCharts.removeChart(this)" title="Remove">✕</button>
        </div>
      </div>
      <div class="chart-card-body">
        <canvas id="${chartId}" height="220"></canvas>
      </div>`;

    container.insertBefore(wrapper, container.firstChild);
    _customCharts.push(chartId);

    // Clear input
    const input = document.getElementById('chart-query-input');
    if (input) input.value = '';

    setTimeout(() => {
      try {
        const canvas = document.getElementById(chartId);
        if (!canvas) return;
        if (_chartInstances[chartId]) _chartInstances[chartId].destroy();
        _chartInstances[chartId] = new Chart(canvas, {
          type: result.chart.type,
          data: result.chart.data,
          options: {
            ...(result.chart.options || {}),
            responsive: true,
            animation: { duration: 800 },
            plugins: {
              ...(result.chart.options?.plugins || {}),
              legend: { ...(result.chart.options?.plugins?.legend || {}), labels: { color: '#7A90B0', font: { size: 11 }}},
            },
            scales: result.chart.type !== 'doughnut' && result.chart.type !== 'pie' ? {
              x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#4A6080', font: { size: 10 }}},
              y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#4A6080', font: { size: 10 }}},
              ...(result.chart.options?.scales || {})
            } : undefined
          }
        });
      } catch(e) { console.error('Chart render error:', e); }
    }, 50);
  }

  function buildDataContext(stats) {
    return {
      available_files: {
        customers: !!stats.customer_count,
        products: !!stats.product_count,
        transactions: !!stats.transaction_count,
        line_items: !!stats.line_item_count,
      },
      summary: {
        customer_count: stats.customer_count,
        transaction_count: stats.transaction_count,
        total_revenue: stats.total_revenue,
        avg_order_value: stats.avg_order_value,
        repeat_customer_rate: stats.repeat_customer_rate,
        churn_risk_count: stats.churn_risk_count,
      },
      segments: stats.segments ? Object.entries(stats.segments).map(([k,v]) => ({ name: k, count: v.count, total_revenue: v.total, avg_order: v.avg_order_value })) : null,
      monthly_revenue: stats.monthly_revenue || null,
      top_cities: stats.top_cities || null,
      top_countries: stats.top_countries || null,
      acquisition_channels: stats.acquisition_channels || null,
      payment_methods: stats.payment_methods || null,
      loyalty_tiers: stats.loyalty_tiers || null,
      top_products: stats.top_products_by_revenue ? stats.top_products_by_revenue.slice(0,10) : null,
      top_basket_pairs: stats.top_basket_pairs ? stats.top_basket_pairs.slice(0,8) : null,
      top_categories: stats.top_categories || null,
    };
  }

  // ── CHAT MESSAGE UI ──
  function showChatMessage(type, text, alt) {
    const el = document.getElementById('chart-chat-message');
    if (!el) return;
    const icons = { loading:'⟳', impossible:'✕', partial:'⚠', error:'!' };
    const colors = { loading:'var(--teal)', impossible:'var(--red)', partial:'var(--amber)', error:'var(--red)' };
    el.style.display = 'flex';
    el.innerHTML = `
      <div style="width:24px;height:24px;border-radius:50%;background:${colors[type]+'22'};display:flex;align-items:center;justify-content:center;font-size:.75rem;color:${colors[type]};flex-shrink:0;${type==='loading'?'animation:spin .8s linear infinite':''}">${icons[type]}</div>
      <div>
        <div style="font-size:.875rem;color:var(--t1)">${text}</div>
        ${alt ? `<div style="font-size:.8125rem;color:var(--teal);margin-top:4px;cursor:pointer" onclick="ClarixCharts.askChart('${escJs(alt)}')">Try instead: ${alt} →</div>` : ''}
      </div>`;
    if (type === 'loading') return;
    setTimeout(() => hideChatMessage(), 6000);
  }

  function hideChatMessage() {
    const el = document.getElementById('chart-chat-message');
    if (el) el.style.display = 'none';
  }

  function removeChart(btn) {
    const card = btn.closest('.chart-card-custom');
    if (card) card.remove();
  }

  function escJs(s) { return s ? s.replace(/'/g, "\\'").replace(/"/g, '\\"') : ''; }

  return { init, askChart, removeChart, generateSuggestions };
})();

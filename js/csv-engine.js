// ============================================================
// Clarix CSV Engine — Client-side only
// Parses, validates, normalises, and computes statistics
// from uploaded CSV files. Raw customer data NEVER leaves
// the browser — only summary statistics go to Claude AI.
// ============================================================

window.ClarixEngine = (() => {

  // ── Uploaded raw data (browser memory only) ──
  let _raw = { customers: null, products: null, transactions: null, lineitems: null };
  let _parsed = {};
  let _transforms = [];

  // ── FILE HANDLING ──
  function parseCSV(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
        complete: r => resolve(r.data),
        error: e => reject(e)
      });
    });
  }

  async function loadFile(type, file) {
    const raw = await parseCSV(file);
    _raw[type] = raw;
    _transforms = [];
    return { rows: raw.length, columns: Object.keys(raw[0] || {}) };
  }

  // ── AI FIELD MAPPING ──
  // Maps common column name variations to our standard schema
  const FIELD_MAPS = {
    customers: {
      customer_id: ['cust_id','id','customerid','customer_no','cust_no','uid','user_id','userid'],
      email: ['email_address','emailaddress','mail','e_mail'],
      first_name: ['firstname','fname','given_name','first'],
      last_name: ['lastname','lname','surname','last','family_name'],
      full_name: ['name','fullname','full_name','customer_name','customername'],
      phone: ['phone_number','phonenumber','mobile','mobile_number','tel','telephone'],
      gender: ['sex','g'],
      date_of_birth: ['dob','birth_date','birthdate','birthday','born'],
      age: ['customer_age','age_years'],
      city: ['town','locality'],
      state: ['province','region','state_name'],
      country: ['country_name','nation'],
      pincode: ['zip','zipcode','postal_code','postcode','pin'],
      signup_date: ['registration_date','created_at','created_date','join_date','joined_date','account_created','member_since'],
      acquisition_channel: ['source','channel','acq_channel','utm_source','referral_source'],
      loyalty_tier: ['tier','membership_tier','loyalty_level','member_tier','rank'],
      loyalty_points: ['points','reward_points','loyalty_balance'],
      email_opt_in: ['email_consent','marketing_consent','opt_in','subscribed','newsletter'],
      is_active: ['active','status','account_status'],
    },
    products: {
      product_id: ['prod_id','sku','sku_id','item_id','pid','product_code'],
      product_name: ['name','item_name','product','title','description'],
      category_l1: ['category','main_category','primary_category','dept','department','cat'],
      category_l2: ['subcategory','sub_category','secondary_category','sub_cat'],
      category_l3: ['tertiary_category','sub_subcategory'],
      brand: ['brand_name','manufacturer','make'],
      selling_price: ['price','mrp','sale_price','retail_price','unit_price','list_price'],
      cost_price: ['cost','cogs','purchase_price','buying_price'],
      margin_pct: ['margin','gross_margin','profit_margin'],
      currency: ['currency_code','cur'],
      stock_status: ['inventory_status','availability','in_stock','available'],
      launch_date: ['release_date','added_date','created_at'],
    },
    transactions: {
      transaction_id: ['order_id','orderid','txn_id','txnid','invoice_id','purchase_id','trans_id'],
      customer_id: ['cust_id','userid','user_id','buyer_id'],
      transaction_date: ['order_date','date','purchase_date','created_at','txn_date','ordered_at'],
      total_amount: ['amount','total','order_total','grand_total','revenue','value','price_paid'],
      subtotal: ['sub_total','before_discount','base_amount'],
      discount_amount: ['discount','coupon_amount','savings','reduction'],
      discount_code: ['coupon','promo_code','voucher','coupon_code'],
      tax_amount: ['tax','gst','vat','taxes'],
      shipping_amount: ['shipping','delivery_fee','freight','shipping_cost'],
      payment_method: ['payment','pay_method','payment_type','payment_mode'],
      channel: ['sales_channel','store','source','platform'],
      device_type: ['device','platform','medium'],
      order_status: ['status','state','fulfillment_status'],
      delivery_city: ['ship_city','shipping_city','to_city'],
      delivery_state: ['ship_state','shipping_state','to_state'],
      delivery_country: ['ship_country','shipping_country','to_country'],
      currency: ['currency_code','cur'],
    },
    lineitems: {
      line_item_id: ['id','line_id','item_id','row_id'],
      transaction_id: ['order_id','orderid','txn_id'],
      product_id: ['prod_id','sku','item_id'],
      quantity: ['qty','units','count','amount'],
      unit_price: ['price','item_price','selling_price','unit_selling_price'],
      unit_cost: ['cost','item_cost','cogs'],
      line_total: ['total','line_amount','item_total','subtotal','extended_price'],
      discount_amount: ['discount','item_discount'],
      discount_pct: ['discount_percent','discount_rate','pct_discount'],
      is_returned: ['returned','refunded','return'],
      return_date: ['returned_date','refund_date'],
      variant: ['variation','option','attributes','size_color'],
    }
  };

  function mapFields(rows, type) {
    if (!rows || rows.length === 0) return { rows: [], transforms: [] };
    const schema = FIELD_MAPS[type];
    const actualKeys = Object.keys(rows[0]);
    const mapping = {}; // actualKey -> standardKey
    const applied = [];

    // Build reverse mapping
    for (const [stdKey, aliases] of Object.entries(schema)) {
      if (actualKeys.includes(stdKey)) { mapping[stdKey] = stdKey; continue; }
      for (const alias of aliases) {
        if (actualKeys.includes(alias)) {
          mapping[alias] = stdKey;
          applied.push({ field: stdKey, action: `Mapped "${alias}" → "${stdKey}"`, color: 'teal' });
          break;
        }
      }
    }

    const mapped = rows.map(row => {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        const std = mapping[k] || k;
        out[std] = v;
      }
      return out;
    });

    return { rows: mapped, transforms: applied };
  }

  // ── NORMALISATION ──
  function normaliseDate(val) {
    if (!val) return null;
    const s = String(val).trim();
    // ISO already
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    // DD/MM/YYYY or DD-MM-YYYY
    const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
    // MM/DD/YYYY (US)
    const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2) return `${m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
    // Try native
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0,10);
    return null;
  }

  function normaliseAmount(val) {
    if (val === null || val === undefined || val === '') return null;
    const s = String(val).trim().replace(/[,$£€₹\s]/g, '').replace(/,/g,'');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function normaliseGender(val) {
    if (!val) return null;
    const v = String(val).trim().toLowerCase();
    if (['m','male','man','boy','1'].includes(v)) return 'Male';
    if (['f','female','woman','girl','0','2'].includes(v)) return 'Female';
    if (['other','non-binary','nb','nonbinary','x'].includes(v)) return 'Other';
    return val;
  }

  function normaliseBool(val) {
    if (val === null || val === undefined) return null;
    const v = String(val).trim().toLowerCase();
    if (['true','1','yes','y','t'].includes(v)) return true;
    if (['false','0','no','n','f'].includes(v)) return false;
    return null;
  }

  function normaliseChannel(val) {
    if (!val) return null;
    const v = String(val).trim().toLowerCase().replace(/\s+/g,'_');
    const map = { website:'web', site:'web', mobile_app:'app', application:'app', phone:'app',
                  instore:'store', in_store:'store', offline:'store', bricks:'store',
                  facebook:'social', instagram:'social', twitter:'social',
                  amazon:'marketplace', flipkart:'marketplace', meesho:'marketplace' };
    return map[v] || v;
  }

  function normalisePayment(val) {
    if (!val) return null;
    const v = String(val).trim().toLowerCase().replace(/\s+/g,'_');
    const map = { cc:'credit_card', credit:'credit_card', debit:'debit_card', dc:'debit_card',
                  cod:'cod', cash:'cod', cash_on_delivery:'cod',
                  upi:'upi', gpay:'upi', phonepe:'upi', paytm:'upi',
                  emi:'emi', no_cost_emi:'emi',
                  wallet:'wallet', prepaid:'wallet', netbanking:'netbanking', neft:'netbanking' };
    return map[v] || v;
  }

  // ── COMPUTE STATISTICS (what we send to Claude) ──
  function computeStats(customers, transactions, products, lineitems) {
    const stats = {};

    // Customer stats
    if (customers) {
      const cities = {}, countries = {}, tiers = {}, channels = {}, genders = {};
      let activeCount = 0;
      customers.forEach(c => {
        if (c.city) cities[c.city] = (cities[c.city]||0)+1;
        if (c.country) countries[c.country] = (countries[c.country]||0)+1;
        if (c.loyalty_tier) tiers[c.loyalty_tier] = (tiers[c.loyalty_tier]||0)+1;
        if (c.acquisition_channel) channels[c.acquisition_channel] = (channels[c.acquisition_channel]||0)+1;
        if (c.gender) genders[c.gender] = (genders[c.gender]||0)+1;
        if (c.is_active !== false) activeCount++;
      });
      stats.customer_count = customers.length;
      stats.active_customers = activeCount;
      stats.top_cities = topN(cities, 8);
      stats.top_countries = topN(countries, 5);
      stats.loyalty_tiers = tiers;
      stats.acquisition_channels = channels;
      stats.gender_split = genders;
      stats.has_loyalty = Object.keys(tiers).length > 0;
    }

    // Transaction stats
    if (transactions) {
      const amounts = transactions.map(t => t.total_amount).filter(a => a > 0);
      const byCustomer = {};
      const byDate = {};
      const channels = {}, paymentMethods = {};
      let totalRevenue = 0;

      transactions.forEach(t => {
        const amt = t.total_amount || 0;
        totalRevenue += amt;
        if (t.customer_id) {
          if (!byCustomer[t.customer_id]) byCustomer[t.customer_id] = { count:0, total:0, dates:[] };
          byCustomer[t.customer_id].count++;
          byCustomer[t.customer_id].total += amt;
          if (t.transaction_date) byCustomer[t.customer_id].dates.push(t.transaction_date);
        }
        if (t.channel) channels[t.channel] = (channels[t.channel]||0)+1;
        if (t.payment_method) paymentMethods[t.payment_method] = (paymentMethods[t.payment_method]||0)+1;
        const month = (t.transaction_date||'').slice(0,7);
        if (month) byDate[month] = (byDate[month]||0) + amt;
      });

      const custOrders = Object.values(byCustomer);
      const now = new Date();

      // RFM computation
      const rfm = {};
      Object.entries(byCustomer).forEach(([cid, data]) => {
        const lastDate = data.dates.sort().pop();
        const daysSince = lastDate ? Math.floor((now - new Date(lastDate)) / 86400000) : 999;
        const freq = data.count;
        const monetary = data.total;
        // Simple RFM scoring (1-5)
        const r = daysSince <= 30 ? 5 : daysSince <= 60 ? 4 : daysSince <= 90 ? 3 : daysSince <= 180 ? 2 : 1;
        const f = freq >= 10 ? 5 : freq >= 6 ? 4 : freq >= 3 ? 3 : freq >= 2 ? 2 : 1;
        const m = monetary >= 10000 ? 5 : monetary >= 5000 ? 4 : monetary >= 2000 ? 3 : monetary >= 500 ? 2 : 1;
        const score = r + f + m;
        const segment = score >= 13 ? 'champions' : score >= 10 ? 'loyalists' : score >= 7 ? 'potential' : score >= 4 ? 'at_risk' : 'lost';
        rfm[cid] = { r, f, m, score, segment, days_since: daysSince, order_count: freq, total_spent: monetary };
      });

      // Segment counts & values
      const segs = { champions:{count:0,total:0}, loyalists:{count:0,total:0}, potential:{count:0,total:0}, at_risk:{count:0,total:0}, lost:{count:0,total:0} };
      Object.values(rfm).forEach(c => {
        segs[c.segment].count++;
        segs[c.segment].total += c.total_spent;
      });
      Object.keys(segs).forEach(s => {
        segs[s].avg_order_value = segs[s].count > 0 ? Math.round(segs[s].total / segs[s].count) : 0;
        segs[s].total = Math.round(segs[s].total);
      });

      // Churn risk (at_risk segment or champions who haven't bought in 90+ days)
      const churnRisk = Object.values(rfm).filter(c => c.days_since > 90 && c.order_count >= 2);

      stats.transaction_count = transactions.length;
      stats.total_revenue = Math.round(totalRevenue);
      stats.avg_order_value = amounts.length > 0 ? Math.round(amounts.reduce((a,b)=>a+b,0)/amounts.length) : 0;
      stats.max_order_value = amounts.length > 0 ? Math.round(Math.max(...amounts)) : 0;
      stats.min_order_value = amounts.length > 0 ? Math.round(Math.min(...amounts)) : 0;
      stats.repeat_customer_rate = Math.round((custOrders.filter(c=>c.count>1).length / custOrders.length) * 100);
      stats.avg_orders_per_customer = parseFloat((custOrders.reduce((a,c)=>a+c.count,0)/custOrders.length).toFixed(1));
      stats.segments = segs;
      stats.churn_risk_count = churnRisk.length;
      stats.churn_revenue_at_risk = Math.round(churnRisk.reduce((a,c)=>a+c.total_spent,0));
      stats.sales_channels = channels;
      stats.payment_methods = paymentMethods;
      stats.monthly_revenue = Object.entries(byDate).sort((a,b)=>a[0]<b[0]?-1:1).slice(-12).map(([m,v])=>({month:m,revenue:Math.round(v)}));
      stats.rfm_data = rfm; // kept for basket analysis, not sent to Claude raw
    }

    // Product stats
    if (products) {
      const cats = {}, brands = {};
      let totalProducts = 0, priceSum = 0, marginSum = 0, marginCount = 0;
      products.forEach(p => {
        totalProducts++;
        if (p.selling_price) priceSum += p.selling_price;
        if (p.margin_pct) { marginSum += p.margin_pct; marginCount++; }
        if (p.category_l1) cats[p.category_l1] = (cats[p.category_l1]||0)+1;
        if (p.brand) brands[p.brand] = (brands[p.brand]||0)+1;
      });
      stats.product_count = totalProducts;
      stats.avg_selling_price = totalProducts > 0 ? Math.round(priceSum/totalProducts) : 0;
      stats.avg_margin_pct = marginCount > 0 ? Math.round(marginSum/marginCount) : null;
      stats.top_categories = topN(cats, 10);
      stats.top_brands = topN(brands, 10);
      stats.has_cost_data = marginCount > 0;
    }

    // Line item stats (basket analysis)
    if (lineitems && products) {
      const productMap = {};
      products.forEach(p => { productMap[p.product_id] = p; });

      const coOccurrence = {}; // track which products appear together
      const txnProducts = {}; // transaction_id -> [product_ids]
      const productRevenue = {}; // product_id -> revenue

      lineitems.forEach(li => {
        if (!li.transaction_id || !li.product_id) return;
        if (!txnProducts[li.transaction_id]) txnProducts[li.transaction_id] = [];
        txnProducts[li.transaction_id].push(li.product_id);
        const rev = (li.unit_price || 0) * (parseInt(li.quantity) || 1);
        productRevenue[li.product_id] = (productRevenue[li.product_id]||0) + rev;
      });

      // Top products by revenue
      const topProducts = Object.entries(productRevenue)
        .sort((a,b)=>b[1]-a[1]).slice(0,20)
        .map(([pid, rev]) => ({ product_id: pid, name: productMap[pid]?.product_name || pid, category: productMap[pid]?.category_l1 || 'Unknown', revenue: Math.round(rev) }));

      // Simple basket pairs (top pairs only for performance)
      const pairs = {};
      Object.values(txnProducts).forEach(prods => {
        if (prods.length < 2) return;
        for (let i = 0; i < Math.min(prods.length, 5); i++) {
          for (let j = i+1; j < Math.min(prods.length, 5); j++) {
            const key = [prods[i],prods[j]].sort().join('|');
            pairs[key] = (pairs[key]||0)+1;
          }
        }
      });

      const topPairs = Object.entries(pairs)
        .sort((a,b)=>b[1]-a[1]).slice(0,15)
        .map(([key, count]) => {
          const [a,b] = key.split('|');
          return { product_a: productMap[a]?.product_name || a, product_b: productMap[b]?.product_name || b, co_occurrence_count: count };
        });

      stats.line_item_count = lineitems.length;
      stats.top_products_by_revenue = topProducts;
      stats.top_basket_pairs = topPairs;
      stats.avg_basket_size = parseFloat((lineitems.length / Object.keys(txnProducts).length).toFixed(1));
      stats.has_basket_data = true;
    }

    // Available modules based on data
    const modules = ['segments','churn'];
    if (stats.has_loyalty) modules.push('loyalty');
    if (stats.has_basket_data) { modules.push('upsell','crosssell'); }
    if (modules.length >= 2) modules.push('campaigns');
    stats.modules_available = modules;

    // Remove raw rfm_data before sending to API (too large)
    const toSend = { ...stats };
    delete toSend.rfm_data;
    return { full: stats, forClaude: toSend };
  }

  function topN(obj, n) {
    return Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>({name:k,count:v}));
  }

  // ── NORMALISE DATASETS ──
  function normaliseCustomers(rows) {
    return rows.map(r => ({
      ...r,
      gender: normaliseGender(r.gender),
      date_of_birth: normaliseDate(r.date_of_birth),
      signup_date: normaliseDate(r.signup_date),
      email_opt_in: normaliseBool(r.email_opt_in),
      is_active: normaliseBool(r.is_active),
      acquisition_channel: r.acquisition_channel ? normaliseChannel(r.acquisition_channel) : null,
    }));
  }

  function normaliseTransactions(rows) {
    return rows.map(r => ({
      ...r,
      transaction_date: normaliseDate(r.transaction_date),
      total_amount: normaliseAmount(r.total_amount),
      discount_amount: normaliseAmount(r.discount_amount),
      tax_amount: normaliseAmount(r.tax_amount),
      shipping_amount: normaliseAmount(r.shipping_amount),
      channel: r.channel ? normaliseChannel(r.channel) : null,
      payment_method: r.payment_method ? normalisePayment(r.payment_method) : null,
    })).filter(r => r.total_amount !== null);
  }

  function normaliseProducts(rows) {
    return rows.map(r => ({
      ...r,
      selling_price: normaliseAmount(r.selling_price),
      cost_price: normaliseAmount(r.cost_price),
      margin_pct: r.margin_pct ? parseFloat(r.margin_pct) : (r.selling_price && r.cost_price ? Math.round(((r.selling_price-r.cost_price)/r.selling_price)*100) : null),
      launch_date: normaliseDate(r.launch_date),
    }));
  }

  function normaliseLineitems(rows) {
    return rows.map(r => ({
      ...r,
      quantity: parseInt(r.quantity) || 1,
      unit_price: normaliseAmount(r.unit_price),
      unit_cost: normaliseAmount(r.unit_cost),
      line_total: normaliseAmount(r.line_total) || (normaliseAmount(r.unit_price) * (parseInt(r.quantity)||1)),
      discount_amount: normaliseAmount(r.discount_amount),
      is_returned: normaliseBool(r.is_returned),
      return_date: normaliseDate(r.return_date),
    }));
  }

  // ── VALIDATE ──
  function validate(type, rows) {
    const errors = [], warnings = [];
    if (type === 'customers') {
      const noId = rows.filter(r => !r.customer_id && !r.email).length;
      if (noId > 0) errors.push(`${noId} rows missing both customer_id and email`);
      const noDate = rows.filter(r => !r.signup_date).length;
      if (noDate > rows.length * 0.3) warnings.push(`${noDate} customers missing signup_date`);
    }
    if (type === 'transactions') {
      const noDate = rows.filter(r => !r.transaction_date).length;
      if (noDate > 0) errors.push(`${noDate} transactions missing date — time-based analysis unavailable`);
      const noAmt = rows.filter(r => !r.total_amount).length;
      if (noAmt > 0) warnings.push(`${noAmt} transactions with no amount — excluded from revenue totals`);
    }
    return { errors, warnings };
  }

  // ── PUBLIC API ──
  return {
    loadFile,
    mapFields,

    async processAll() {
      _parsed = {};
      _transforms = [];

      if (_raw.customers) {
        const { rows, transforms } = mapFields(_raw.customers, 'customers');
        _parsed.customers = normaliseCustomers(rows);
        _transforms.push(...transforms);
      }
      if (_raw.transactions) {
        const { rows, transforms } = mapFields(_raw.transactions, 'transactions');
        _parsed.transactions = normaliseTransactions(rows);
        _transforms.push(...transforms);
      }
      if (_raw.products) {
        const { rows, transforms } = mapFields(_raw.products, 'products');
        _parsed.products = normaliseProducts(rows);
        _transforms.push(...transforms);
      }
      if (_raw.lineitems) {
        const { rows, transforms } = mapFields(_raw.lineitems, 'lineitems');
        _parsed.lineitems = normaliseLineitems(rows);
        _transforms.push(...transforms);
      }

      const stats = computeStats(_parsed.customers, _parsed.transactions, _parsed.products, _parsed.lineitems);
      return { stats, transforms: _transforms };
    },

    getTransforms() { return _transforms; },
    getParsed() { return _parsed; },
    getRaw() { return _raw; },
    hasFile(type) { return !!_raw[type]; },
    canRun() { return !!_raw.customers && !!_raw.transactions; },

    validate(type) {
      const rows = _parsed[type] || _raw[type] || [];
      return validate(type, rows);
    }
  };
})();

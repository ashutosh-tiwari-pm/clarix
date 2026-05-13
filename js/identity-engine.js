// ============================================================
// Clarix Identity Engine
// Identity Resolution + Household Graph
// 100% client-side — no data leaves the browser
// Configurable match rules based on user's actual CSV fields
// ============================================================

window.ClarixIdentity = (() => {

  // ── FIELD METADATA ──
  // Defines how each known field can be matched
  const FIELD_META = {
    email:            { label:'Email',            category:'identity',   defaultWeight:40, matchTypes:['exact','fuzzy'],   suggestedType:'exact',  householdSignal:false },
    phone:            { label:'Phone',             category:'identity',   defaultWeight:38, matchTypes:['exact','prefix'],  suggestedType:'exact',  householdSignal:true  },
    mobile:           { label:'Mobile',            category:'identity',   defaultWeight:38, matchTypes:['exact','prefix'],  suggestedType:'exact',  householdSignal:true  },
    first_name:       { label:'First Name',        category:'name',       defaultWeight:15, matchTypes:['exact','fuzzy'],   suggestedType:'fuzzy',  householdSignal:false },
    last_name:        { label:'Last Name',         category:'name',       defaultWeight:25, matchTypes:['exact','fuzzy'],   suggestedType:'fuzzy',  householdSignal:true  },
    full_name:        { label:'Full Name',         category:'name',       defaultWeight:25, matchTypes:['exact','fuzzy'],   suggestedType:'fuzzy',  householdSignal:false },
    surname:          { label:'Surname',           category:'name',       defaultWeight:25, matchTypes:['exact','fuzzy'],   suggestedType:'fuzzy',  householdSignal:true  },
    pincode:          { label:'Pincode / ZIP',     category:'location',   defaultWeight:20, matchTypes:['exact','prefix'],  suggestedType:'exact',  householdSignal:true  },
    zip:              { label:'ZIP Code',          category:'location',   defaultWeight:20, matchTypes:['exact','prefix'],  suggestedType:'exact',  householdSignal:true  },
    postal_code:      { label:'Postal Code',       category:'location',   defaultWeight:20, matchTypes:['exact'],           suggestedType:'exact',  householdSignal:true  },
    city:             { label:'City',              category:'location',   defaultWeight:10, matchTypes:['exact','fuzzy'],   suggestedType:'exact',  householdSignal:false },
    state:            { label:'State / Province',  category:'location',   defaultWeight:8,  matchTypes:['exact'],           suggestedType:'exact',  householdSignal:false },
    country:          { label:'Country',           category:'location',   defaultWeight:5,  matchTypes:['exact'],           suggestedType:'exact',  householdSignal:false },
    address:          { label:'Street Address',    category:'location',   defaultWeight:45, matchTypes:['exact','fuzzy'],   suggestedType:'fuzzy',  householdSignal:true  },
    street_address:   { label:'Street Address',    category:'location',   defaultWeight:45, matchTypes:['exact','fuzzy'],   suggestedType:'fuzzy',  householdSignal:true  },
    delivery_address: { label:'Delivery Address',  category:'location',   defaultWeight:45, matchTypes:['exact','fuzzy'],   suggestedType:'fuzzy',  householdSignal:true  },
    landline:         { label:'Landline',          category:'identity',   defaultWeight:40, matchTypes:['exact','prefix'],  suggestedType:'exact',  householdSignal:true  },
    date_of_birth:    { label:'Date of Birth',     category:'identity',   defaultWeight:30, matchTypes:['exact'],           suggestedType:'exact',  householdSignal:false },
    national_id:      { label:'National ID',       category:'identity',   defaultWeight:50, matchTypes:['exact'],           suggestedType:'exact',  householdSignal:false },
    loyalty_points:   { label:'Loyalty Points',    category:'behavioural',defaultWeight:8,  matchTypes:['range'],           suggestedType:'range',  householdSignal:false },
    gender:           { label:'Gender',            category:'demographic',defaultWeight:5,  matchTypes:['exact'],           suggestedType:'exact',  householdSignal:false },
  };

  // Non-matchable fields (skip these in rule builder)
  const SKIP_FIELDS = new Set(['customer_id','id','created_at','updated_at','email_opt_in','is_active','preferred_channel','acquisition_channel','loyalty_tier','signup_date','tags']);

  // ── DETECT AVAILABLE FIELDS ──
  function detectFields(customers) {
    if (!customers || customers.length === 0) return [];
    const keys = Object.keys(customers[0]);
    return keys
      .filter(k => !SKIP_FIELDS.has(k))
      .filter(k => {
        // Must have at least 30% non-empty values
        const filled = customers.filter(c => c[k] && String(c[k]).trim()).length;
        return filled / customers.length > 0.3;
      })
      .map(k => ({
        field: k,
        label: FIELD_META[k]?.label || k.replace(/_/g,' ').replace(/\b\w/g, l => l.toUpperCase()),
        category: FIELD_META[k]?.category || 'other',
        defaultWeight: FIELD_META[k]?.defaultWeight || 15,
        matchTypes: FIELD_META[k]?.matchTypes || ['exact','fuzzy'],
        suggestedType: FIELD_META[k]?.suggestedType || 'exact',
        householdSignal: FIELD_META[k]?.householdSignal ?? false,
        fillRate: Math.round((customers.filter(c => c[k] && String(c[k]).trim()).length / customers.length) * 100),
      }));
  }

  // ── STRING MATCHING UTILS ──
  function normalise(s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g,' ');
  }

  function levenshtein(a, b) {
    if (!a || !b) return 0;
    a = normalise(a); b = normalise(b);
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const matrix = Array.from({length: b.length+1}, (_, i) => [i]);
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        matrix[i][j] = b[i-1] === a[j-1]
          ? matrix[i-1][j-1]
          : Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
      }
    }
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - matrix[b.length][a.length] / maxLen;
  }

  function matchScore(v1, v2, matchType) {
    if (!v1 || !v2) return 0;
    const a = normalise(v1), b = normalise(v2);
    if (!a || !b) return 0;
    switch (matchType) {
      case 'exact':   return a === b ? 1 : 0;
      case 'fuzzy':   return levenshtein(a, b);
      case 'partial': return a.includes(b) || b.includes(a) ? 0.8 : 0;
      case 'prefix':  const n = Math.min(6, Math.min(a.length, b.length));
                      return a.slice(0,n) === b.slice(0,n) ? 0.7 : 0;
      case 'range':   const n1 = parseFloat(v1), n2 = parseFloat(v2);
                      if (isNaN(n1)||isNaN(n2)) return 0;
                      const diff = Math.abs(n1-n2)/Math.max(n1,n2,1);
                      return diff < 0.1 ? 1 : diff < 0.25 ? 0.6 : 0;
      default:        return a === b ? 1 : 0;
    }
  }

  // ── IDENTITY RESOLUTION ──
  function runIdentityResolution(customers, rules, threshold) {
    // rules: [{ field, matchType, weight, enabled }]
    const activeRules = rules.filter(r => r.enabled && r.weight > 0);
    if (activeRules.length === 0) return [];

    const totalWeight = activeRules.reduce((s,r) => s+r.weight, 0);
    const clusters = [];
    const matched = new Set();

    // O(n²) comparison — fine for typical CDP datasets (<100k)
    // For larger datasets we'd use blocking keys first
    for (let i = 0; i < customers.length; i++) {
      if (matched.has(i)) continue;
      for (let j = i+1; j < customers.length; j++) {
        if (matched.has(j)) continue;
        const c1 = customers[i], c2 = customers[j];

        let weightedScore = 0;
        const signals = [];

        for (const rule of activeRules) {
          const s = matchScore(c1[rule.field], c2[rule.field], rule.matchType);
          if (s > 0) {
            weightedScore += (rule.weight * s);
            signals.push({
              field: rule.field,
              label: rule.label,
              score: s,
              matchType: rule.matchType,
              v1: c1[rule.field],
              v2: c2[rule.field],
            });
          }
        }

        const pct = Math.round((weightedScore / totalWeight) * 100);
        if (pct >= threshold) {
          clusters.push({
            id: `MATCH-${clusters.length+1}`,
            confidence: pct,
            customers: [c1, c2],
            signals,
            status: 'review', // review | merged | dismissed
          });
          matched.add(j); // don't re-match c2
        }
      }
    }

    return clusters.sort((a,b) => b.confidence - a.confidence);
  }

  // ── HOUSEHOLD GRAPH ──
  function runHouseholdGraph(customers, rules, minSignals, transactions) {
    const activeRules = rules.filter(r => r.enabled);
    if (activeRules.length === 0) return [];

    // Build delivery address lookup from transactions if available
    const custDelivery = {};
    if (transactions && transactions.length > 0) {
      transactions.forEach(t => {
        if (t.customer_id && (t.delivery_city || t.delivery_address)) {
          if (!custDelivery[t.customer_id]) custDelivery[t.customer_id] = [];
          const addr = [t.delivery_address, t.delivery_city, t.delivery_state, t.delivery_country].filter(Boolean).join(', ');
          if (addr) custDelivery[t.customer_id].push(addr);
        }
      });
    }

    // Union-Find for clustering
    const parent = customers.map((_, i) => i);
    const signalCount = customers.map(() => ({}));

    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(x, y, signal) {
      const px = find(x), py = find(y);
      if (px !== py) {
        parent[px] = py;
        if (!signalCount[py][signal]) signalCount[py][signal] = 0;
        signalCount[py][signal]++;
      }
    }

    // Run each enabled rule
    for (let i = 0; i < customers.length; i++) {
      for (let j = i+1; j < customers.length; j++) {
        const c1 = customers[i], c2 = customers[j];

        for (const rule of activeRules) {
          let matched = false;
          if (rule.field === 'delivery_address' && custDelivery[c1.customer_id] && custDelivery[c2.customer_id]) {
            // Check if any delivery addresses overlap
            const addrs1 = custDelivery[c1.customer_id];
            const addrs2 = custDelivery[c2.customer_id];
            matched = addrs1.some(a1 => addrs2.some(a2 => levenshtein(a1,a2) > 0.85));
          } else if (rule.field === 'phone_prefix') {
            const p1 = normalise(c1.phone || c1.mobile || '').replace(/\D/g,'').slice(0,6);
            const p2 = normalise(c2.phone || c2.mobile || '').replace(/\D/g,'').slice(0,6);
            matched = p1.length >= 6 && p1 === p2;
          } else if (rule.field === 'surname_pincode') {
            const surname1 = normalise(c1.last_name || c1.surname || '');
            const surname2 = normalise(c2.last_name || c2.surname || '');
            const pin1 = normalise(c1.pincode || c1.zip || '');
            const pin2 = normalise(c2.pincode || c2.zip || '');
            matched = surname1 && surname1 === surname2 && pin1 && pin1 === pin2;
          } else {
            const s = matchScore(c1[rule.field], c2[rule.field], rule.matchType || 'exact');
            matched = s > 0.85;
          }
          if (matched) union(i, j, rule.label);
        }
      }
    }

    // Collect clusters
    const groups = {};
    customers.forEach((c, i) => {
      const root = find(i);
      if (!groups[root]) groups[root] = [];
      groups[root].push({ customer: c, index: i });
    });

    // Build household objects — only groups with 2+ members
    const households = Object.values(groups)
      .filter(g => g.length >= 2)
      .map((g, idx) => {
        const members = g.map(({ customer }) => customer);

        // Calculate household value from transactions
        const memberIds = new Set(members.map(m => m.customer_id));
        let hhRevenue = 0;
        if (transactions) {
          transactions.forEach(t => {
            if (memberIds.has(t.customer_id)) hhRevenue += (t.total_amount || 0);
          });
        }

        // Find best contact (highest value + most recent)
        const bestContact = members.reduce((best, m) => {
          if (!best) return m;
          // Compare by loyalty tier rank
          const tierRank = { Platinum:4, Gold:3, Silver:2, Bronze:1 };
          const bestScore = tierRank[best.loyalty_tier] || 0;
          const mScore = tierRank[m.loyalty_tier] || 0;
          return mScore > bestScore ? m : best;
        }, null);

        // Address inference
        const addressParts = [];
        const sample = members[0];
        if (sample.city) addressParts.push(sample.city);
        if (sample.state) addressParts.push(sample.state);
        if (sample.country) addressParts.push(sample.country);
        if (sample.pincode) addressParts.push(sample.pincode);

        // Signals used
        const signals = [];
        const surnames = [...new Set(members.map(m => normalise(m.last_name || m.surname || '')).filter(Boolean))];
        if (surnames.length === 1) signals.push(`Same surname: ${surnames[0]}`);
        const pincodes = [...new Set(members.map(m => m.pincode || m.zip || '').filter(Boolean))];
        if (pincodes.length === 1) signals.push(`Same pincode: ${pincodes[0]}`);
        if (custDelivery) signals.push('Shared delivery address');

        const confidence = Math.min(95, 60 + (signals.length * 15));

        return {
          id: `HH-${String(idx+1).padStart(3,'0')}`,
          confidence,
          address: addressParts.join(', ') || 'Address not available',
          members,
          bestContact,
          hhRevenue: Math.round(hhRevenue),
          signals,
          suppressList: members.filter(m => m.customer_id !== bestContact?.customer_id).map(m => m.customer_id),
        };
      })
      .sort((a,b) => b.hhRevenue - a.hhRevenue);

    return households;
  }

  // ── CUSTOMER PROFILE (individual) ──
  function buildCustomerProfile(customer, transactions) {
    const custTxns = (transactions || []).filter(t => t.customer_id === customer.customer_id);
    const totalSpend = custTxns.reduce((s,t) => s + (t.total_amount||0), 0);
    const orderCount = custTxns.length;
    const avgOrder = orderCount > 0 ? totalSpend / orderCount : 0;
    const lastOrderDate = custTxns.length > 0 ? custTxns.map(t=>t.transaction_date).sort().pop() : null;
    const daysSinceLast = lastOrderDate ? Math.floor((new Date() - new Date(lastOrderDate)) / 86400000) : null;
    const channels = [...new Set(custTxns.map(t=>t.channel).filter(Boolean))];
    const paymentMethods = [...new Set(custTxns.map(t=>t.payment_method).filter(Boolean))];
    const cities = [...new Set(custTxns.map(t=>t.delivery_city).filter(Boolean))];

    return {
      ...customer,
      totalSpend: Math.round(totalSpend),
      orderCount,
      avgOrder: Math.round(avgOrder),
      lastOrderDate,
      daysSinceLast,
      preferredChannels: channels,
      preferredPayments: paymentMethods,
      deliveryCities: cities,
    };
  }

  // Public API
  return {
    detectFields,
    runIdentityResolution,
    runHouseholdGraph,
    buildCustomerProfile,
    levenshtein,
    normalise,
  };
})();

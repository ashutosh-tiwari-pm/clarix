-- ============================================
-- Clarix — Raw Data Storage
-- Stores uploaded CSV data per analysis
-- Run in Supabase SQL Editor
-- ============================================

-- Uploaded datasets table (one row per CSV file per analysis)
CREATE TABLE IF NOT EXISTS uploaded_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  dataset_type TEXT NOT NULL CHECK (dataset_type IN ('customers','transactions','products','lineitems')),
  row_count INTEGER NOT NULL DEFAULT 0,
  column_names TEXT[],                    -- column names from CSV header
  storage_mode TEXT NOT NULL DEFAULT 'session' CHECK (storage_mode IN ('session','saved')),
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(analysis_id, dataset_type)
);

-- Raw customer records
CREATE TABLE IF NOT EXISTS raw_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  customer_id TEXT,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Raw transaction records
CREATE TABLE IF NOT EXISTS raw_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  transaction_id TEXT,
  customer_id TEXT,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Raw product records
CREATE TABLE IF NOT EXISTS raw_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id TEXT,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Raw line item records
CREATE TABLE IF NOT EXISTS raw_lineitems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  transaction_id TEXT,
  product_id TEXT,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast retrieval
CREATE INDEX IF NOT EXISTS idx_raw_cust_analysis ON raw_customers(analysis_id);
CREATE INDEX IF NOT EXISTS idx_raw_cust_user ON raw_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_raw_txn_analysis ON raw_transactions(analysis_id);
CREATE INDEX IF NOT EXISTS idx_raw_txn_cid ON raw_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_raw_prod_analysis ON raw_products(analysis_id);
CREATE INDEX IF NOT EXISTS idx_raw_li_analysis ON raw_lineitems(analysis_id);
CREATE INDEX IF NOT EXISTS idx_datasets_analysis ON uploaded_datasets(analysis_id);
CREATE INDEX IF NOT EXISTS idx_datasets_user ON uploaded_datasets(user_id);

-- RLS
ALTER TABLE uploaded_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_lineitems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own uploaded_datasets"
  ON uploaded_datasets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own raw_customers"
  ON raw_customers FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own raw_transactions"
  ON raw_transactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own raw_products"
  ON raw_products FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own raw_lineitems"
  ON raw_lineitems FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

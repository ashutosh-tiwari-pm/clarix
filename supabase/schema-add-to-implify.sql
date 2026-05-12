-- ============================================
-- Clarix — Add to existing Implify Supabase project
-- Safe to run alongside Implify tables
-- Skips profiles table and handle_new_user trigger
-- (already created by Implify)
-- ============================================

-- Clarix core tables
CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('data', 'research')),
  brand_name TEXT,
  brand_url TEXT,
  industry TEXT,
  data_summary JSONB,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','processing','complete','error')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  module TEXT NOT NULL CHECK (module IN (
    'segments','upsell','crosssell','churn','loyalty','campaigns','overview'
  )),
  output JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(analysis_id, module)
);

-- Triggers (update_updated_at function already exists from Implify)
CREATE TRIGGER analyses_updated_at
  BEFORE UPDATE ON analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER insights_updated_at
  BEFORE UPDATE ON insights
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_analysis_id ON insights(analysis_id);

-- RLS
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own analyses"
  ON analyses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own insights"
  ON insights FOR ALL
  USING (analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid()))
  WITH CHECK (analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid()));

-- ============================================
-- Clarix — AI Growth Engine
-- Database Schema
-- ============================================

CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('data', 'research')),
  -- For research mode
  brand_name TEXT,
  brand_url TEXT,
  industry TEXT,
  -- Data summary stats (never raw customer data)
  data_summary JSONB,
  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','processing','complete','error')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  module TEXT NOT NULL CHECK (module IN (
    'segments','upsell','crosssell','churn','campaigns','growth','overview'
  )),
  output JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(analysis_id, module)
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  company TEXT,
  role TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER analyses_updated_at BEFORE UPDATE ON analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER insights_updated_at BEFORE UPDATE ON insights FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX idx_analyses_user_id ON analyses(user_id);
CREATE INDEX idx_insights_analysis_id ON insights(analysis_id);

-- RLS
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own analyses" ON analyses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own insights" ON insights FOR ALL USING (analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid())) WITH CHECK (analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid()));
CREATE POLICY "Users manage own profile" ON profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Auto-create profile
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN INSERT INTO public.profiles (id) VALUES (NEW.id); RETURN NEW; END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

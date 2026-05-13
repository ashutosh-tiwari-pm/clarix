-- ============================================
-- Clarix — Customer Profiles & Households
-- Run this in Supabase SQL Editor
-- Safe to run on existing Clarix + Implify project
-- ============================================

-- Customer profiles table (one row per customer per analysis)
CREATE TABLE IF NOT EXISTS customer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  customer_id TEXT NOT NULL,
  raw_data JSONB NOT NULL,           -- all fields from customers.csv
  computed JSONB,                    -- totalSpend, orderCount, avgOrder, daysSinceLast, etc.
  tags TEXT[],                       -- ['champion','repeat_buyer','at_risk'] etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(analysis_id, customer_id)
);

-- Households table (one row per household per analysis)
CREATE TABLE IF NOT EXISTS households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  household_ref TEXT NOT NULL,       -- e.g. HH-001
  confidence INTEGER,
  address TEXT,
  signals TEXT[],
  member_ids TEXT[],                 -- customer_id array
  best_contact_id TEXT,
  hh_revenue NUMERIC,
  suppress_list TEXT[],
  member_data JSONB,                 -- full member objects
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(analysis_id, household_ref)
);

-- User app profiles (for Clarix profile settings)
CREATE TABLE IF NOT EXISTS clarix_user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  company TEXT,
  role TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Triggers
CREATE TRIGGER customer_profiles_updated_at
  BEFORE UPDATE ON customer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER clarix_profiles_updated_at
  BEFORE UPDATE ON clarix_user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cprofiles_analysis ON customer_profiles(analysis_id);
CREATE INDEX IF NOT EXISTS idx_cprofiles_user ON customer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_households_analysis ON households(analysis_id);

-- Storage bucket for avatars
INSERT INTO storage.buckets (id, name, public)
  VALUES ('clarix-avatars', 'clarix-avatars', true)
  ON CONFLICT (id) DO NOTHING;

-- Storage policy
CREATE POLICY "Users manage own clarix avatar"
  ON storage.objects FOR ALL
  USING (bucket_id = 'clarix-avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'clarix-avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- RLS
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE clarix_user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own customer_profiles"
  ON customer_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own households"
  ON households FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own clarix_user_profile"
  ON clarix_user_profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Auto-create clarix profile on signup
CREATE OR REPLACE FUNCTION handle_new_clarix_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.clarix_user_profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only add trigger if not already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_clarix_auth_user_created'
  ) THEN
    CREATE TRIGGER on_clarix_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_clarix_user();
  END IF;
END $$;


CREATE TYPE public.round_status AS ENUM ('draft', 'open', 'closed');
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- user_roles first so has_role can reference it
CREATE TABLE public.user_roles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- countries
CREATE TABLE public.countries (code text PRIMARY KEY, name text NOT NULL, flag text NOT NULL);
GRANT SELECT ON public.countries TO anon, authenticated;
GRANT ALL ON public.countries TO service_role;
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read countries" ON public.countries FOR SELECT USING (true);
CREATE POLICY "Admins manage countries" ON public.countries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- editions
CREATE TABLE public.editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.editions TO anon, authenticated;
GRANT ALL ON public.editions TO service_role;
ALTER TABLE public.editions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read editions" ON public.editions FOR SELECT USING (true);
CREATE POLICY "Admins manage editions" ON public.editions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_editions_updated_at BEFORE UPDATE ON public.editions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- rounds
CREATE TABLE public.rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES public.editions(id) ON DELETE CASCADE,
  name text NOT NULL,
  status public.round_status NOT NULL DEFAULT 'draft',
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_rounds_single_open ON public.rounds ((true)) WHERE status = 'open';
GRANT SELECT ON public.rounds TO anon, authenticated;
GRANT ALL ON public.rounds TO service_role;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read rounds" ON public.rounds FOR SELECT USING (true);
CREATE POLICY "Admins manage rounds" ON public.rounds FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_rounds_updated_at BEFORE UPDATE ON public.rounds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- round_countries
CREATE TABLE public.round_countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  country_code text NOT NULL REFERENCES public.countries(code),
  display_order integer NOT NULL,
  UNIQUE (round_id, country_code),
  UNIQUE (round_id, display_order)
);
GRANT SELECT ON public.round_countries TO anon, authenticated;
GRANT ALL ON public.round_countries TO service_role;
ALTER TABLE public.round_countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read round_countries" ON public.round_countries FOR SELECT USING (true);
CREATE POLICY "Admins manage round_countries" ON public.round_countries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- vote_submissions
CREATE TABLE public.vote_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  username text NOT NULL,
  username_normalized text NOT NULL,
  country_code text NOT NULL,
  ip_hash text,
  fingerprint_hash text,
  device_token_hash text,
  risk_score integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_vs_round_username ON public.vote_submissions (round_id, username_normalized);
CREATE UNIQUE INDEX idx_vs_round_ip ON public.vote_submissions (round_id, ip_hash) WHERE ip_hash IS NOT NULL;
CREATE UNIQUE INDEX idx_vs_round_fp ON public.vote_submissions (round_id, fingerprint_hash) WHERE fingerprint_hash IS NOT NULL;
CREATE UNIQUE INDEX idx_vs_round_dt ON public.vote_submissions (round_id, device_token_hash) WHERE device_token_hash IS NOT NULL;
GRANT SELECT ON public.vote_submissions TO authenticated;
GRANT ALL ON public.vote_submissions TO service_role;
ALTER TABLE public.vote_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read vote_submissions" ON public.vote_submissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- vote_entries
CREATE TABLE public.vote_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.vote_submissions(id) ON DELETE CASCADE,
  target_country_code text NOT NULL,
  points integer NOT NULL CHECK (points >= 1 AND points <= 10),
  UNIQUE (submission_id, target_country_code)
);
GRANT SELECT ON public.vote_entries TO authenticated;
GRANT ALL ON public.vote_entries TO service_role;
ALTER TABLE public.vote_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read vote_entries" ON public.vote_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- anti_abuse_events
CREATE TABLE public.anti_abuse_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES public.rounds(id) ON DELETE SET NULL,
  username text,
  username_normalized text,
  country_code text,
  ip_hash text,
  fingerprint_hash text,
  device_token_hash text,
  reason text NOT NULL,
  risk_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked', 'whitelisted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.anti_abuse_events TO authenticated;
GRANT ALL ON public.anti_abuse_events TO service_role;
ALTER TABLE public.anti_abuse_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage anti_abuse_events" ON public.anti_abuse_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed countries
INSERT INTO public.countries (code, name, flag) VALUES
('AF','Afghanistan','🇦🇫'),('AL','Albania','🇦🇱'),('DZ','Algeria','🇩🇿'),('AD','Andorra','🇦🇩'),('AO','Angola','🇦🇴'),
('AG','Antigua and Barbuda','🇦🇬'),('AR','Argentina','🇦🇷'),('AM','Armenia','🇦🇲'),('AU','Australia','🇦🇺'),('AT','Austria','🇦🇹'),
('AZ','Azerbaijan','🇦🇿'),('BS','Bahamas','🇧🇸'),('BH','Bahrain','🇧🇭'),('BD','Bangladesh','🇧🇩'),('BB','Barbados','🇧🇧'),
('BY','Belarus','🇧🇾'),('BE','Belgium','🇧🇪'),('BZ','Belize','🇧🇿'),('BJ','Benin','🇧🇯'),('BT','Bhutan','🇧🇹'),
('BO','Bolivia','🇧🇴'),('BA','Bosnia and Herzegovina','🇧🇦'),('BW','Botswana','🇧🇼'),('BR','Brazil','🇧🇷'),('BN','Brunei','🇧🇳'),
('BG','Bulgaria','🇧🇬'),('BF','Burkina Faso','🇧🇫'),('BI','Burundi','🇧🇮'),('CV','Cabo Verde','🇨🇻'),('KH','Cambodia','🇰🇭'),
('CM','Cameroon','🇨🇲'),('CA','Canada','🇨🇦'),('CF','Central African Republic','🇨🇫'),('TD','Chad','🇹🇩'),('CL','Chile','🇨🇱'),
('CN','China','🇨🇳'),('CO','Colombia','🇨🇴'),('KM','Comoros','🇰🇲'),('CG','Congo','🇨🇬'),('CD','DR Congo','🇨🇩'),
('CR','Costa Rica','🇨🇷'),('CI','Côte d''Ivoire','🇨🇮'),('HR','Croatia','🇭🇷'),('CU','Cuba','🇨🇺'),('CY','Cyprus','🇨🇾'),
('CZ','Czechia','🇨🇿'),('DK','Denmark','🇩🇰'),('DJ','Djibouti','🇩🇯'),('DM','Dominica','🇩🇲'),('DO','Dominican Republic','🇩🇴'),
('EC','Ecuador','🇪🇨'),('EG','Egypt','🇪🇬'),('SV','El Salvador','🇸🇻'),('GQ','Equatorial Guinea','🇬🇶'),('ER','Eritrea','🇪🇷'),
('EE','Estonia','🇪🇪'),('SZ','Eswatini','🇸🇿'),('ET','Ethiopia','🇪🇹'),('FJ','Fiji','🇫🇯'),('FI','Finland','🇫🇮'),
('FR','France','🇫🇷'),('GA','Gabon','🇬🇦'),('GM','Gambia','🇬🇲'),('GE','Georgia','🇬🇪'),('DE','Germany','🇩🇪'),
('GH','Ghana','🇬🇭'),('GR','Greece','🇬🇷'),('GD','Grenada','🇬🇩'),('GT','Guatemala','🇬🇹'),('GN','Guinea','🇬🇳'),
('GW','Guinea-Bissau','🇬🇼'),('GY','Guyana','🇬🇾'),('HT','Haiti','🇭🇹'),('HN','Honduras','🇭🇳'),('HU','Hungary','🇭🇺'),
('IS','Iceland','🇮🇸'),('IN','India','🇮🇳'),('ID','Indonesia','🇮🇩'),('IR','Iran','🇮🇷'),('IQ','Iraq','🇮🇶'),
('IE','Ireland','🇮🇪'),('IL','Israel','🇮🇱'),('IT','Italy','🇮🇹'),('JM','Jamaica','🇯🇲'),('JP','Japan','🇯🇵'),
('JO','Jordan','🇯🇴'),('KZ','Kazakhstan','🇰🇿'),('KE','Kenya','🇰🇪'),('KI','Kiribati','🇰🇮'),('KP','North Korea','🇰🇵'),
('KR','South Korea','🇰🇷'),('KW','Kuwait','🇰🇼'),('KG','Kyrgyzstan','🇰🇬'),('LA','Laos','🇱🇦'),('LV','Latvia','🇱🇻'),
('LB','Lebanon','🇱🇧'),('LS','Lesotho','🇱🇸'),('LR','Liberia','🇱🇷'),('LY','Libya','🇱🇾'),('LI','Liechtenstein','🇱🇮'),
('LT','Lithuania','🇱🇹'),('LU','Luxembourg','🇱🇺'),('MG','Madagascar','🇲🇬'),('MW','Malawi','🇲🇼'),('MY','Malaysia','🇲🇾'),
('MV','Maldives','🇲🇻'),('ML','Mali','🇲🇱'),('MT','Malta','🇲🇹'),('MH','Marshall Islands','🇲🇭'),('MR','Mauritania','🇲🇷'),
('MU','Mauritius','🇲🇺'),('MX','Mexico','🇲🇽'),('FM','Micronesia','🇫🇲'),('MD','Moldova','🇲🇩'),('MC','Monaco','🇲🇨'),
('MN','Mongolia','🇲🇳'),('ME','Montenegro','🇲🇪'),('MA','Morocco','🇲🇦'),('MZ','Mozambique','🇲🇿'),('MM','Myanmar','🇲🇲'),
('NA','Namibia','🇳🇦'),('NR','Nauru','🇳🇷'),('NP','Nepal','🇳🇵'),('NL','Netherlands','🇳🇱'),('NZ','New Zealand','🇳🇿'),
('NI','Nicaragua','🇳🇮'),('NE','Niger','🇳🇪'),('NG','Nigeria','🇳🇬'),('MK','North Macedonia','🇲🇰'),('NO','Norway','🇳🇴'),
('OM','Oman','🇴🇲'),('PK','Pakistan','🇵🇰'),('PW','Palau','🇵🇼'),('PS','Palestine','🇵🇸'),('PA','Panama','🇵🇦'),
('PG','Papua New Guinea','🇵🇬'),('PY','Paraguay','🇵🇾'),('PE','Peru','🇵🇪'),('PH','Philippines','🇵🇭'),('PL','Poland','🇵🇱'),
('PT','Portugal','🇵🇹'),('QA','Qatar','🇶🇦'),('RO','Romania','🇷🇴'),('RU','Russia','🇷🇺'),('RW','Rwanda','🇷🇼'),
('KN','Saint Kitts and Nevis','🇰🇳'),('LC','Saint Lucia','🇱🇨'),('VC','Saint Vincent','🇻🇨'),('WS','Samoa','🇼🇸'),('SM','San Marino','🇸🇲'),
('ST','São Tomé and Príncipe','🇸🇹'),('SA','Saudi Arabia','🇸🇦'),('SN','Senegal','🇸🇳'),('RS','Serbia','🇷🇸'),('SC','Seychelles','🇸🇨'),
('SL','Sierra Leone','🇸🇱'),('SG','Singapore','🇸🇬'),('SK','Slovakia','🇸🇰'),('SI','Slovenia','🇸🇮'),('SB','Solomon Islands','🇸🇧'),
('SO','Somalia','🇸🇴'),('ZA','South Africa','🇿🇦'),('SS','South Sudan','🇸🇸'),('ES','Spain','🇪🇸'),('LK','Sri Lanka','🇱🇰'),
('SD','Sudan','🇸🇩'),('SR','Suriname','🇸🇷'),('SE','Sweden','🇸🇪'),('CH','Switzerland','🇨🇭'),('SY','Syria','🇸🇾'),
('TW','Taiwan','🇹🇼'),('TJ','Tajikistan','🇹🇯'),('TZ','Tanzania','🇹🇿'),('TH','Thailand','🇹🇭'),('TL','Timor-Leste','🇹🇱'),
('TG','Togo','🇹🇬'),('TO','Tonga','🇹🇴'),('TT','Trinidad and Tobago','🇹🇹'),('TN','Tunisia','🇹🇳'),('TR','Turkey','🇹🇷'),
('TM','Turkmenistan','🇹🇲'),('TV','Tuvalu','🇹🇻'),('UG','Uganda','🇺🇬'),('UA','Ukraine','🇺🇦'),('AE','United Arab Emirates','🇦🇪'),
('GB','United Kingdom','🇬🇧'),('US','United States','🇺🇸'),('UY','Uruguay','🇺🇾'),('UZ','Uzbekistan','🇺🇿'),('VU','Vanuatu','🇻🇺'),
('VA','Vatican City','🇻🇦'),('VE','Venezuela','🇻🇪'),('VN','Vietnam','🇻🇳'),('YE','Yemen','🇾🇪'),('ZM','Zambia','🇿🇲'),
('ZW','Zimbabwe','🇿🇼'),('XK','Kosovo','🇽🇰'),('PR','Puerto Rico','🇵🇷'),('HK','Hong Kong','🇭🇰'),('MO','Macau','🇲🇴'),
('GI','Gibraltar','🇬🇮'),('FO','Faroe Islands','🇫🇴'),('GL','Greenland','🇬🇱'),('AW','Aruba','🇦🇼'),('CW','Curaçao','🇨🇼'),
('GG','Guernsey','🇬🇬'),('JE','Jersey','🇯🇪'),('IM','Isle of Man','🇮🇲')
ON CONFLICT (code) DO NOTHING;

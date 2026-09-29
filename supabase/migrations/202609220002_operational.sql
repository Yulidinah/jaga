-- 202609220002_operational.sql
-- Melengkapi skema agar seluruh fitur platform JAGA dapat dipakai.
-- Hanya menambah kolom/tabel yang dibutuhkan API dan seed; tidak mengubah
-- bobot keselamatan, ambang prioritas, atau logika rekomendasi.
-- Jalankan setelah 202609220001_initial_jaga.sql. Aman dijalankan ulang.

begin;

-- ---------------------------------------------------------------- Profiles
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists title text;
create unique index if not exists profiles_email_key on public.profiles (lower(email)) where email is not null;

-- ---------------------------------------------------------------- Wilayah
alter table public.villages add column if not exists regency text;
alter table public.villages add column if not exists population integer;
alter table public.villages add column if not exists access_notes text;
alter table public.villages add column if not exists latitude double precision;
alter table public.villages add column if not exists longitude double precision;
alter table public.villages add column if not exists active boolean not null default true;
comment on column public.villages.latitude is 'Salinan center agar peta dan rute tidak perlu mengubah geometri';

-- Zona bahaya dan titik kumpul: simpan titik pusat/koordinat agar bisa
-- digambar di peta dan dipakai perhitungan rute tanpa membongkar geometri.
alter table public.hazard_zones add column if not exists center_latitude double precision;
alter table public.hazard_zones add column if not exists center_longitude double precision;
alter table public.hazard_zones add column if not exists radius_meters integer;
alter table public.hazard_zones add column if not exists active boolean not null default true;
update public.hazard_zones hz
set center_latitude = sub.lat,
    center_longitude = sub.lon
from (
  select id, st_y(st_centroid(area::geometry)) as lat, st_x(st_centroid(area::geometry)) as lon
  from public.hazard_zones
  where area is not null
) sub
where sub.id = hz.id and (hz.center_latitude is null or hz.center_longitude is null);

alter table public.evacuation_shelters add column if not exists latitude double precision;
alter table public.evacuation_shelters add column if not exists longitude double precision;
update public.evacuation_shelters es
set latitude = sub.lat, longitude = sub.lon
from (
  select id, st_y(location::geometry) as lat, st_x(location::geometry) as lon
  from public.evacuation_shelters
  where location is not null
) sub
where sub.id = es.id and (es.latitude is null or es.longitude is null);

-- ------------------------------------------------------- Perangkat & gateway
-- Kunci disimpan sebagai hash SHA-256; kunci asli hanya ditampilkan sekali
-- saat rotasi dan tidak pernah ditulis ke database.
alter table public.devices add column if not exists auth_key_hash text;
alter table public.devices add column if not exists notes text;
alter table public.devices add column if not exists updated_at timestamptz not null default now();
alter table public.gateways add column if not exists auth_key_hash text;
alter table public.gateways add column if not exists notes text;
alter table public.gateways add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------- Tim
alter table public.rescue_teams add column if not exists home_village_id uuid references public.villages(id);
alter table public.rescue_teams add column if not exists latitude double precision;
alter table public.rescue_teams add column if not exists longitude double precision;
alter table public.rescue_teams add column if not exists capacity integer;
alter table public.rescue_teams add column if not exists phone text;
alter table public.rescue_teams add column if not exists active boolean not null default true;
alter table public.rescue_teams add column if not exists updated_at timestamptz not null default now();
alter table public.team_location_history add column if not exists latitude double precision;
alter table public.team_location_history add column if not exists longitude double precision;

-- ------------------------------------------------------------------ Insiden
alter table public.incidents add column if not exists severity public.alert_severity;
alter table public.incidents add column if not exists affected_count integer;
alter table public.incidents add column if not exists source text;
alter table public.incidents add column if not exists village_access_notes text;
comment on column public.incidents.source is 'MANUAL | DEVICE | GATEWAY | ASSESSMENT';

-- -------------------------------------------------------------- Notifikasi
alter table public.notifications add column if not exists destination text;
alter table public.notifications add column if not exists template_code text;
alter table public.notifications add column if not exists village_id uuid references public.villages(id);
alter table public.notifications add column if not exists resident_id uuid references public.residents(id);
-- Format yang belum punya kolom eksplisit (mis. "MESSAGE") ditolak enum.
alter table public.notifications add column if not exists category text;

-- ---------------------------------------------------------------- Audit log
alter table public.audit_logs add column if not exists summary text;
alter table public.audit_logs add column if not exists user_agent text;

-- ------------------------------------------------------------------- Rute
-- Rute dihitung di backend (Haversine + difficulty akses), bukan dari network
-- jalan. Kolom path (geography) tetap dipakai untuk analisis spasial,
-- path_wkt menyimpan garis yang sama dalam bentuk teks untuk ditampilkan.
alter table public.evacuation_routes add column if not exists path_wkt text;
alter table public.evacuation_routes add column if not exists access_penalty numeric;
alter table public.evacuation_routes add column if not exists is_estimate boolean not null default true;
comment on column public.evacuation_routes.is_estimate is 'Selalu true: rute JAGA adalah estimasi, bukan rute jalan pasti';

-- ------------------------------------------------- Ambang tingkat prioritas
-- Struktur mengikuti seed: satu set ambang per rule set.
create table if not exists public.priority_thresholds (
  rule_set_id uuid not null references public.priority_rule_sets(id) on delete cascade,
  level public.recommendation_level not null,
  min_score numeric not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (rule_set_id, level)
);
create index if not exists priority_thresholds_rule_set_idx
  on public.priority_thresholds (rule_set_id, min_score desc);

insert into public.priority_thresholds (rule_set_id, level, min_score, display_order)
select rs.id, v.level, v.min_score, v.display_order
from public.priority_rule_sets rs
cross join (values
  ('PANTAU'::public.recommendation_level, -999::numeric, 0),
  ('SEGERA_TINJAU',  25, 1),
  ('RESPONS_CEPAT', 45, 2),
  ('DARURAT',       70, 3)
) as v(level, min_score, display_order)
on conflict (rule_set_id, level) do nothing;

-- ------------------------------------------------- Hak akses service_role
-- Portal_postgrest menulis lewat service_role; pastikan haknya berlaku
-- juga untuk tabel yang dibuat setelah migration ini.
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.residents enable row level security;
alter table public.incidents enable row level security;
alter table public.devices enable row level security;
alter table public.rescue_teams enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

commit;

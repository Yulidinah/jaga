begin;

create extension if not exists pgcrypto;
create extension if not exists postgis;

create type public.jaga_role as enum ('PUSAT', 'DESA', 'RESCUE');
create type public.organization_type as enum ('PUSAT', 'PEMERINTAH_DESA', 'BPBD', 'BASARNAS', 'DAMKAR', 'POLISI', 'TNI', 'RELAWAN', 'LAYANAN_KESEHATAN', 'LAINNYA');
create type public.vulnerability_category as enum ('DISABILITAS', 'LANSIA', 'IBU_HAMIL', 'ANAK', 'PENYAKIT_KRONIS', 'CEDERA', 'LAINNYA');
create type public.incident_status as enum ('NEW', 'ACKNOWLEDGED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'EVACUATED', 'SAFE', 'CANCELLED', 'CLOSED');
create type public.alert_severity as enum ('WASPADA', 'SIAGA', 'EVAKUASI');
create type public.alert_target_type as enum ('DESA', 'DUSUN', 'KELOMPOK_RENTAN', 'PERANGKAT', 'ZONA');
create type public.command_status as enum ('QUEUED', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED');
create type public.device_status as enum ('STOCK', 'ASSIGNED', 'MAINTENANCE', 'LOST', 'RETIRED');
create type public.team_status as enum ('AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'ON_SCENE', 'OFF_DUTY');
create type public.notification_channel as enum ('IN_APP', 'PUSH', 'SMS', 'EMAIL');
create type public.notification_status as enum ('QUEUED', 'SENT', 'READ', 'FAILED');
create type public.rule_set_status as enum ('DRAFT', 'ACTIVE', 'ARCHIVED');
create type public.recommendation_level as enum ('PANTAU', 'SEGERA_TINJAU', 'RESPONS_CEPAT', 'DARURAT');

-- Referensi wilayah resmi Indonesia. Kode dapat mengikuti kode Kemendagri/BPS.
create table public.provinces (id text primary key, name text not null unique);
create table public.regencies (
  id text primary key,
  province_id text not null references public.provinces(id),
  name text not null,
  unique (province_id, name)
);
create table public.districts (
  id text primary key,
  regency_id text not null references public.regencies(id),
  name text not null,
  unique (regency_id, name)
);
create table public.villages (
  id uuid primary key default gen_random_uuid(),
  government_code text unique,
  district_id text references public.districts(id),
  name text not null,
  district text,
  province text,
  center geography(point, 4326),
  created_at timestamptz not null default now()
);
create table public.hamlets (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (village_id, name)
);

-- Organisasi menaungi akun Pusat, pemerintah desa, dan tim Rescue.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.organization_type not null,
  phone text,
  email text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.organization_service_areas (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete cascade,
  primary key (organization_id, village_id)
);
-- auth.users menyimpan kredensial; profiles menyimpan identitas dan role JAGA.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  role public.jaga_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);

-- Warga adalah penerima manfaat; target utama sistem adalah kelompok rentan.
create table public.residents (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id),
  hamlet_id uuid references public.hamlets(id),
  national_id_encrypted text,
  full_name text not null,
  birth_date date,
  gender text check (gender in ('LAKI_LAKI', 'PEREMPUAN', 'LAINNYA')),
  phone text,
  address text,
  latitude double precision,
  longitude double precision,
  location geography(point, 4326),
  lives_alone boolean not null default false,
  mobility_notes text,
  communication_notes text,
  medical_notes text,
  evacuation_notes text,
  active boolean not null default true,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
);
-- Kamus kelompok rentan: tunarungu, tunanetra, lansia, ibu hamil, dan lainnya.
create table public.vulnerability_types (
  id uuid primary key default gen_random_uuid(),
  category public.vulnerability_category not null,
  code text not null unique,
  name text not null,
  description text,
  default_assistance text,
  active boolean not null default true
);
create table public.resident_vulnerabilities (
  resident_id uuid not null references public.residents(id) on delete cascade,
  vulnerability_type_id uuid not null references public.vulnerability_types(id),
  severity smallint check (severity between 1 and 5),
  assistance_notes text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  primary key (resident_id, vulnerability_type_id)
);
create table public.resident_contacts (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.residents(id) on delete cascade,
  name text not null,
  relationship text,
  phone text not null,
  is_primary boolean not null default false,
  lives_with_resident boolean not null default false
);

create table public.evacuation_shelters (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id),
  name text not null,
  address text,
  location geography(point, 4326) not null,
  capacity integer check (capacity is null or capacity >= 0),
  accessibility_notes text,
  active boolean not null default true
);
create table public.hazard_zones (
  id uuid primary key default gen_random_uuid(),
  village_id uuid references public.villages(id),
  name text not null,
  hazard_type text not null,
  risk_level smallint not null check (risk_level between 1 and 5),
  area geography(multipolygon, 4326) not null,
  access_notes text,
  active_from timestamptz,
  active_until timestamptz,
  created_at timestamptz not null default now()
);

-- Perangkat dipisahkan dari warga agar perangkat dapat diganti tanpa kehilangan riwayat.
create table public.devices (
  id text primary key,
  village_id uuid references public.villages(id),
  owner_name text not null default '', -- kompatibilitas API awal; sumber utama residents
  hardware_serial text unique,
  model text,
  firmware_version text,
  status public.device_status not null default 'STOCK',
  latitude double precision not null,
  longitude double precision not null,
  battery integer not null default 100 check (battery between 0 and 100),
  online boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.device_assignments (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.devices(id),
  resident_id uuid not null references public.residents(id),
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  notes text,
  check (unassigned_at is null or unassigned_at >= assigned_at)
);
create unique index one_active_assignment_per_device on public.device_assignments(device_id) where unassigned_at is null;
create unique index one_active_device_per_resident on public.device_assignments(resident_id) where unassigned_at is null;
create table public.gateways (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id),
  gateway_code text not null unique,
  name text not null,
  latitude double precision,
  longitude double precision,
  firmware_version text,
  online boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.device_telemetry (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(id) on delete cascade,
  gateway_id uuid references public.gateways(id),
  battery integer check (battery between 0 and 100),
  signal_strength integer,
  temperature numeric,
  payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  village_id uuid references public.villages(id),
  resident_id uuid references public.residents(id),
  device_id text references public.devices(id),
  disaster_type text,
  owner_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  status public.incident_status not null default 'NEW',
  description text,
  resolution_notes text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  evacuated_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.incident_status_history (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  from_status public.incident_status,
  to_status public.incident_status not null,
  changed_by uuid references public.profiles(id),
  notes text,
  location geography(point, 4326),
  created_at timestamptz not null default now()
);

-- Mesin rekomendasi bersifat rule-based, transparan, berversi, dan dapat dioverride.
-- Rule aktif harus disahkan pihak berwenang; migration tidak menetapkan bobot keselamatan.
create table public.priority_rule_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  disaster_type text,
  version integer not null check (version > 0),
  status public.rule_set_status not null default 'DRAFT',
  description text,
  applies_from timestamptz,
  applies_until timestamptz,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (name, version),
  check (applies_until is null or applies_from is null or applies_until > applies_from),
  check (status <> 'ACTIVE' or (approved_by is not null and approved_at is not null))
);

create table public.priority_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.priority_rule_sets(id) on delete cascade,
  factor_key text not null,
  operator text not null check (operator in ('EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'EXISTS')),
  comparison_value jsonb,
  score_delta numeric not null,
  explanation text not null,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Satu assessment adalah potret kondisi terbaru, bukan data profil permanen warga.
create table public.incident_assessments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  assessed_by uuid references public.profiles(id),
  source text not null check (source in ('DESA', 'RESCUE', 'DEVICE', 'SYSTEM')),
  summary text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.assessment_factors (
  id bigint generated always as identity primary key,
  assessment_id uuid not null references public.incident_assessments(id) on delete cascade,
  factor_key text not null,
  factor_value jsonb not null,
  source_note text,
  recorded_at timestamptz not null default now(),
  unique (assessment_id, factor_key)
);

create table public.priority_recommendations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  assessment_id uuid not null references public.incident_assessments(id) on delete cascade,
  rule_set_id uuid not null references public.priority_rule_sets(id),
  score numeric not null,
  suggested_level public.recommendation_level not null,
  reasons jsonb not null default '[]'::jsonb,
  data_completeness numeric not null default 0 check (data_completeness between 0 and 1),
  calculated_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (id, incident_id)
);

create table public.priority_overrides (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  previous_level public.recommendation_level not null,
  selected_level public.recommendation_level not null,
  reason text not null check (length(trim(reason)) >= 10),
  overridden_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (recommendation_id, incident_id)
    references public.priority_recommendations(id, incident_id)
);

create table public.rescue_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  call_sign text,
  vehicle_info text,
  status public.team_status not null default 'AVAILABLE',
  created_at timestamptz not null default now()
);
create table public.rescue_team_members (
  team_id uuid not null references public.rescue_teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_leader boolean not null default false,
  primary key (team_id, profile_id)
);
create table public.incident_assignments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  team_id uuid not null references public.rescue_teams(id),
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  unique (incident_id, team_id)
);
create table public.team_location_history (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.rescue_teams(id) on delete cascade,
  incident_id uuid references public.incidents(id) on delete cascade,
  location geography(point, 4326) not null,
  accuracy_meters numeric,
  recorded_at timestamptz not null default now()
);
create table public.evacuation_routes (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.incidents(id) on delete cascade,
  team_id uuid references public.rescue_teams(id),
  shelter_id uuid references public.evacuation_shelters(id),
  path geography(linestring, 4326),
  distance_meters numeric,
  estimated_seconds integer,
  risk_score smallint check (risk_score between 1 and 5),
  notes text,
  created_at timestamptz not null default now()
);

create table public.alert_commands (
  id uuid primary key default gen_random_uuid(),
  village_id uuid references public.villages(id),
  target text not null, -- kompatibilitas API awal
  target_type public.alert_target_type not null default 'DESA',
  target_reference text,
  severity public.alert_severity not null,
  message text,
  status public.command_status not null default 'QUEUED',
  requested_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create table public.command_receipts (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.alert_commands(id) on delete cascade,
  device_id text not null references public.devices(id),
  status public.command_status not null default 'QUEUED',
  sent_at timestamptz,
  acknowledged_at timestamptz,
  failure_reason text,
  unique (command_id, device_id)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  incident_id uuid references public.incidents(id) on delete cascade,
  channel public.notification_channel not null,
  title text not null,
  body text not null,
  status public.notification_status not null default 'QUEUED',
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  uploaded_by uuid references public.profiles(id),
  storage_path text not null,
  media_type text not null,
  caption text,
  created_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create table public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id),
  client_operation_id text not null,
  entity_type text not null,
  entity_id text,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPLIED', 'CONFLICT', 'FAILED')),
  error_message text,
  client_created_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, client_operation_id)
);

create index regencies_province_idx on public.regencies(province_id);
create index districts_regency_idx on public.districts(regency_id);
create index villages_district_idx on public.villages(district_id);
create index residents_village_idx on public.residents(village_id);
create index residents_location_idx on public.residents using gist(location);
create index vulnerability_category_idx on public.vulnerability_types(category);
create index devices_village_idx on public.devices(village_id);
create index devices_last_seen_idx on public.devices(last_seen_at desc);
create index telemetry_device_time_idx on public.device_telemetry(device_id, recorded_at desc);
create index incidents_status_created_idx on public.incidents(status, created_at desc);
create index incidents_village_created_idx on public.incidents(village_id, created_at desc);
create index incident_history_idx on public.incident_status_history(incident_id, created_at);
create index rule_sets_active_idx on public.priority_rule_sets(status, disaster_type, applies_from);
create index priority_rules_set_idx on public.priority_rules(rule_set_id, display_order);
create index incident_assessments_idx on public.incident_assessments(incident_id, observed_at desc);
create index priority_recommendations_idx on public.priority_recommendations(incident_id, calculated_at desc);
create index priority_overrides_idx on public.priority_overrides(incident_id, created_at desc);
create unique index one_active_rule_set_per_disaster
  on public.priority_rule_sets ((coalesce(disaster_type, '*')))
  where status = 'ACTIVE';
create index team_location_idx on public.team_location_history(team_id, recorded_at desc);
create index team_location_geo_idx on public.team_location_history using gist(location);
create index hazard_zone_geo_idx on public.hazard_zones using gist(area);
create index alert_commands_status_idx on public.alert_commands(status, created_at);
create index notifications_profile_idx on public.notifications(profile_id, created_at desc);
create index audit_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

-- Timestamp konsisten untuk tabel yang dapat diperbarui.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger residents_set_updated_at
before update on public.residents
for each row execute function public.set_updated_at();

create trigger incidents_set_updated_at
before update on public.incidents
for each row execute function public.set_updated_at();

-- Menjamin semua perubahan status tetap memiliki jejak, termasuk jika pemanggil
-- lupa menulis history. Identitas pelaku tetap dicatat backend pada operasi resmi.
create or replace function public.record_incident_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.incident_status_history (incident_id, from_status, to_status)
    values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.incident_status_history (incident_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger incidents_record_status
after insert or update of status on public.incidents
for each row execute function public.record_incident_status_change();

-- View baca-operasional agar backend tidak perlu merangkai relasi yang sama berulang kali.
create view public.resident_support_profiles
with (security_invoker = true)
as
select
  r.id,
  r.village_id,
  r.hamlet_id,
  r.full_name,
  r.birth_date,
  r.lives_alone,
  r.mobility_notes,
  r.communication_notes,
  r.medical_notes,
  r.evacuation_notes,
  r.latitude,
  r.longitude,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', vt.code,
        'name', vt.name,
        'category', vt.category,
        'severity', rv.severity,
        'assistanceNotes', rv.assistance_notes,
        'defaultAssistance', vt.default_assistance
      ) order by vt.name
    ) filter (where vt.id is not null),
    '[]'::jsonb
  ) as vulnerabilities
from public.residents r
left join public.resident_vulnerabilities rv on rv.resident_id = r.id
left join public.vulnerability_types vt on vt.id = rv.vulnerability_type_id
where r.active = true
group by r.id;

create view public.active_device_assignments
with (security_invoker = true)
as
select
  da.id as assignment_id,
  da.device_id,
  da.resident_id,
  r.full_name,
  r.village_id,
  d.battery,
  d.online,
  d.last_seen_at,
  d.status
from public.device_assignments da
join public.devices d on d.id = da.device_id
join public.residents r on r.id = da.resident_id
where da.unassigned_at is null and r.active = true;

create view public.latest_incident_recommendations
with (security_invoker = true)
as
select distinct on (pr.incident_id)
  pr.id,
  pr.incident_id,
  pr.assessment_id,
  pr.rule_set_id,
  pr.score,
  pr.suggested_level,
  pr.reasons,
  pr.data_completeness,
  pr.calculated_at,
  po.selected_level as override_level,
  po.reason as override_reason,
  po.overridden_by,
  po.created_at as overridden_at
from public.priority_recommendations pr
left join lateral (
  select o.selected_level, o.reason, o.overridden_by, o.created_at
  from public.priority_overrides o
  where o.recommendation_id = pr.id
  order by o.created_at desc
  limit 1
) po on true
where pr.superseded_at is null
order by pr.incident_id, pr.calculated_at desc;

insert into public.vulnerability_types (category, code, name, default_assistance)
values
  ('DISABILITAS', 'TUNARUNGU', 'Tunarungu', 'Gunakan cahaya, getaran, teks, dan pendamping komunikasi.'),
  ('DISABILITAS', 'TUNANETRA', 'Tunanetra', 'Berikan panduan suara dan pendamping mobilitas.'),
  ('DISABILITAS', 'TUNADAKSA', 'Disabilitas fisik/mobilitas', 'Siapkan bantuan mobilitas dan jalur yang dapat diakses.'),
  ('DISABILITAS', 'DISABILITAS_INTELEKTUAL', 'Disabilitas intelektual', 'Gunakan instruksi sederhana dan pendamping tepercaya.'),
  ('DISABILITAS', 'AUTISME', 'Autisme', 'Kurangi rangsangan dan gunakan komunikasi yang konsisten.'),
  ('DISABILITAS', 'DISABILITAS_GANDA', 'Disabilitas ganda', 'Ikuti kebutuhan bantuan individual yang telah diverifikasi.'),
  ('LANSIA', 'LANSIA', 'Lansia', 'Prioritaskan pemeriksaan kondisi dan bantuan mobilitas.'),
  ('IBU_HAMIL', 'IBU_HAMIL', 'Ibu hamil', 'Prioritaskan transportasi aman dan bantuan medis bila diperlukan.'),
  ('ANAK', 'ANAK_TANPA_PENDAMPING', 'Anak tanpa pendamping', 'Pastikan pendampingan dan reunifikasi keluarga.'),
  ('PENYAKIT_KRONIS', 'PENYAKIT_KRONIS', 'Penyakit kronis', 'Bawa obat, dokumen medis, dan periksa kebutuhan klinis.')
on conflict (code) do nothing;

-- Klien tidak mengakses tabel langsung; akses operasional sementara melalui backend.
alter table public.provinces enable row level security;
alter table public.regencies enable row level security;
alter table public.districts enable row level security;
alter table public.villages enable row level security;
alter table public.hamlets enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_service_areas enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.residents enable row level security;
alter table public.vulnerability_types enable row level security;
alter table public.resident_vulnerabilities enable row level security;
alter table public.resident_contacts enable row level security;
alter table public.evacuation_shelters enable row level security;
alter table public.hazard_zones enable row level security;
alter table public.devices enable row level security;
alter table public.device_assignments enable row level security;
alter table public.gateways enable row level security;
alter table public.device_telemetry enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_status_history enable row level security;
alter table public.priority_rule_sets enable row level security;
alter table public.priority_rules enable row level security;
alter table public.incident_assessments enable row level security;
alter table public.assessment_factors enable row level security;
alter table public.priority_recommendations enable row level security;
alter table public.priority_overrides enable row level security;
alter table public.rescue_teams enable row level security;
alter table public.rescue_team_members enable row level security;
alter table public.incident_assignments enable row level security;
alter table public.team_location_history enable row level security;
alter table public.evacuation_routes enable row level security;
alter table public.alert_commands enable row level security;
alter table public.command_receipts enable row level security;
alter table public.notifications enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_logs enable row level security;
alter table public.sync_operations enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter publication supabase_realtime add table public.incidents;
alter publication supabase_realtime add table public.incident_status_history;
alter publication supabase_realtime add table public.alert_commands;
alter publication supabase_realtime add table public.command_receipts;
alter publication supabase_realtime add table public.notifications;

-- Data demo fiktif dan saling terhubung untuk pengujian awal.
insert into public.provinces (id, name)
values ('32', 'Jawa Barat')
on conflict (id) do nothing;

insert into public.regencies (id, province_id, name)
values ('3205', '32', 'Kabupaten Garut')
on conflict (id) do nothing;

insert into public.districts (id, regency_id, name)
values ('320501', '3205', 'Kecamatan Sukamaju')
on conflict (id) do nothing;

insert into public.villages (id, government_code, district_id, name, district, province)
values ('10000000-0000-4000-8000-000000000001', '3205012001', '320501', 'Desa Sukamaju', 'Kabupaten Garut', 'Jawa Barat')
on conflict (id) do nothing;

insert into public.hamlets (id, village_id, name)
values ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Dusun Cempaka')
on conflict (id) do nothing;

insert into public.residents (
  id, village_id, hamlet_id, full_name, birth_date, gender, latitude, longitude,
  lives_alone, mobility_notes, communication_notes, medical_notes,
  evacuation_notes, consented_at
)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Siti Aminah', '1954-04-12', 'PEREMPUAN', -7.2279, 107.9087, true, 'Memerlukan bantuan untuk berjalan jauh.', 'Gunakan teks, gerakan visual, atau pendamping.', null, 'Jalan masuk sempit; siapkan satu pendamping.', now()),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Budi Santoso', '1981-09-23', 'LAKI_LAKI', -7.2312, 107.9014, false, 'Dapat berjalan dengan pendamping.', 'Berikan petunjuk suara yang jelas.', null, 'Pendamping keluarga berada di rumah.', now()),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Rina Marlina', '1950-01-08', 'PEREMPUAN', -7.2198, 107.9151, false, 'Menggunakan tongkat.', null, 'Membawa obat rutin.', 'Hindari jalur dengan tangga.', now())
on conflict (id) do nothing;

insert into public.resident_vulnerabilities (resident_id, vulnerability_type_id, severity, assistance_notes)
select '20000000-0000-4000-8000-000000000001', id, 3, 'Pastikan peringatan visual dan pendamping komunikasi.'
from public.vulnerability_types where code = 'TUNARUNGU'
on conflict do nothing;
insert into public.resident_vulnerabilities (resident_id, vulnerability_type_id, severity, assistance_notes)
select '20000000-0000-4000-8000-000000000001', id, 3, 'Memerlukan bantuan mobilitas saat evakuasi.'
from public.vulnerability_types where code = 'LANSIA'
on conflict do nothing;
insert into public.resident_vulnerabilities (resident_id, vulnerability_type_id, severity, assistance_notes)
select '20000000-0000-4000-8000-000000000002', id, 4, 'Sebutkan arah dan hambatan secara verbal.'
from public.vulnerability_types where code = 'TUNANETRA'
on conflict do nothing;
insert into public.resident_vulnerabilities (resident_id, vulnerability_type_id, severity, assistance_notes)
select '20000000-0000-4000-8000-000000000003', id, 2, 'Periksa stamina dan obat sebelum perjalanan.'
from public.vulnerability_types where code = 'LANSIA'
on conflict do nothing;

insert into public.devices (id, village_id, owner_name, latitude, longitude, battery, online, status)
values
  ('JAGA-0048', '10000000-0000-4000-8000-000000000001', 'Siti Aminah', -7.2279, 107.9087, 73, true, 'ASSIGNED'),
  ('JAGA-0052', '10000000-0000-4000-8000-000000000001', 'Budi Santoso', -7.2312, 107.9014, 61, true, 'ASSIGNED'),
  ('JAGA-0061', '10000000-0000-4000-8000-000000000001', 'Rina Marlina', -7.2198, 107.9151, 84, true, 'ASSIGNED')
on conflict (id) do nothing;

insert into public.device_assignments (id, device_id, resident_id, assigned_at)
values
  ('30000000-0000-4000-8000-000000000001', 'JAGA-0048', '20000000-0000-4000-8000-000000000001', now()),
  ('30000000-0000-4000-8000-000000000002', 'JAGA-0052', '20000000-0000-4000-8000-000000000002', now()),
  ('30000000-0000-4000-8000-000000000003', 'JAGA-0061', '20000000-0000-4000-8000-000000000003', now())
on conflict (id) do nothing;

commit;

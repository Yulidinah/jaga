-- 202610080002_sesuai_srs.sql
-- Penyesuaian dengan SRS JAGA v2.0: tombol kalung terkunci dan permintaan bantuan,
-- pengumuman Pusat, pengaturan platform, laporan pasca-operasi Rescue.
-- Jalankan setelah 202610080001_istilah_bmkg_bnpb.sql (yang dijalankan sendirian). Aman dijalankan ulang.

begin;

-- Tombol kalung (FR-4.3): permintaan bantuan dan pelepasan alarm
alter table public.command_receipts add column if not exists assistance_requested_at timestamptz;
alter table public.command_receipts add column if not exists released_at timestamptz;

-- Pengumuman Pusat ke seluruh Desa
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  priority text not null default 'INFO' check (priority in ('INFO', 'PENTING')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- Pengaturan platform (batas offline kalung, kedaluwarsa alarm, kebijakan data untuk Rescue)
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Laporan pasca-operasi Rescue
create table if not exists public.operation_reports (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  village_id uuid references public.villages(id),
  organization_id uuid references public.organizations(id),
  organization_name text,
  team_name text,
  author_id uuid,
  author_name text,
  summary text not null,
  found_count integer not null default 0,
  evacuated_count integer not null default 0,
  not_found_count integer not null default 0,
  unreachable_count integer not null default 0,
  distance_km numeric,
  created_at timestamptz not null default now()
);
create index if not exists operation_reports_op_idx on public.operation_reports (operation_id);

-- RLS aktif tanpa policy: hanya backend (service_role) yang mengakses
alter table public.announcements enable row level security;
alter table public.platform_settings enable row level security;
alter table public.operation_reports enable row level security;
revoke all on public.announcements, public.platform_settings, public.operation_reports from anon, authenticated;
grant all on public.announcements, public.platform_settings, public.operation_reports to service_role;
grant all on all sequences in schema public to service_role;

commit;

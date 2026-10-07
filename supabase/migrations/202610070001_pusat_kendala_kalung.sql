-- 202610070001_pusat_kendala_kalung.sql
-- Kendala teknis (Desa/Rescue -> Pusat) dan inventaris kalung di gudang Pusat.
-- Jalankan setelah 202610060001_hapus_dusun.sql. Aman dijalankan ulang.

begin;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  village_id uuid references public.villages(id),
  organization_id uuid references public.organizations(id),
  reporter_id uuid,
  reporter_role text not null,
  reporter_name text,
  category text not null check (category in ('KALUNG', 'GATEWAY', 'AKUN', 'DATA', 'APLIKASI', 'LAINNYA')),
  priority text not null default 'SEDANG' check (priority in ('RENDAH', 'SEDANG', 'TINGGI')),
  title text not null,
  description text,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index if not exists support_tickets_village_idx on public.support_tickets (village_id);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon, authenticated;
grant all on public.support_tickets to service_role;

-- Kalung di gudang Pusat (belum didistribusikan) tidak punya desa maupun koordinat.
alter table public.devices alter column latitude drop not null;
alter table public.devices alter column longitude drop not null;

commit;

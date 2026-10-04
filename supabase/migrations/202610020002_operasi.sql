-- 202610020002_operasi.sql
-- Operasi: jendela akses data warga untuk JAGA Rescue. Dibuka JAGA Desa saat alarm Siaga/Evakuasi dibunyikan,
-- ditutup oleh Desa/Pusat. Selama ACTIVE, Rescue dapat melihat roster pemakai kalung di area operasi.
-- Jalankan setelah 202610020001_perbaikan_audit.sql. Aman dijalankan ulang.

begin;

create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  severity public.alert_severity not null,
  disaster_type text not null default 'BANJIR',
  area_type text not null default 'DESA' check (area_type in ('DESA', 'DUSUN')),
  hamlet_ids jsonb not null default '[]'::jsonb,
  water_level_cm integer check (water_level_cm is null or water_level_cm between 0 and 2000),
  note text,
  alert_command_id uuid references public.alert_commands(id),
  opened_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  close_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'CLOSED' or closed_at is not null)
);

-- Satu operasi aktif per desa; alarm berikutnya meningkatkan operasi yang ada.
create unique index if not exists one_active_operation_per_village
  on public.operations (village_id) where status = 'ACTIVE';
create index if not exists operations_status_village_idx on public.operations (status, village_id);

alter table public.operations enable row level security;
revoke all on public.operations from anon, authenticated;
grant all on public.operations to service_role;

commit;

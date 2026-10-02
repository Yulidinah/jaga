-- 202610020001_perbaikan_audit.sql
-- Perbaikan hasil audit (docs/temuan-audit.md). Jalankan setelah migrasi 001 dan 002. Aman dijalankan ulang.

begin;

-- Backend mencatat riwayat status sendiri (lengkap dengan pelaku dan catatan).
-- Trigger lama menyisipkan baris kedua untuk setiap perubahan status.
drop trigger if exists incidents_record_status on public.incidents;
drop function if exists public.record_incident_status_change();

-- API menyimpan posisi tim sebagai latitude/longitude; kolom geografi boleh kosong.
alter table public.team_location_history alter column location drop not null;
alter table public.team_location_history add column if not exists latitude double precision;
alter table public.team_location_history add column if not exists longitude double precision;

-- Pencarian cepat untuk inbox perangkat dan penugasan aktif.
create index if not exists command_receipts_device_status_idx on public.command_receipts (device_id, status);
create index if not exists incident_assignments_team_idx on public.incident_assignments (team_id) where completed_at is null;
create index if not exists notifications_village_idx on public.notifications (village_id, created_at desc);

commit;

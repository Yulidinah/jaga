-- 202610050001_gps_dan_sinyal.sql
-- GPS kalung: waktu dan akurasi posisi terakhir pada perangkat, serta riwayat posisi pada telemetri.
-- Jalankan setelah 202610030001_prioritas.sql. Aman dijalankan ulang.

begin;

alter table public.devices add column if not exists location_at timestamptz;
alter table public.devices add column if not exists location_accuracy_m numeric;

alter table public.device_telemetry add column if not exists latitude double precision;
alter table public.device_telemetry add column if not exists longitude double precision;
alter table public.device_telemetry add column if not exists accuracy_m numeric;
alter table public.device_telemetry add column if not exists gps_fix boolean;
alter table public.device_telemetry add column if not exists satellites integer;

comment on column public.devices.location_at is 'Waktu posisi GPS terakhir yang diterima (bukan sekadar sinyal hidup)';
comment on column public.device_telemetry.gps_fix is 'false = kalung belum mendapat fix GPS; koordinat tidak dipakai';

commit;

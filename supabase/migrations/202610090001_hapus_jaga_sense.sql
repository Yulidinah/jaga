-- 202610090001_hapus_jaga_sense.sql
-- Menghapus komponen JAGA Sense dari basis data yang sudah menjalankan migrasi lama.

begin;

drop table if exists public.sensor_readings cascade;
drop table if exists public.sensors cascade;

alter table public.villages drop column if exists flood_waspada_cm;
alter table public.villages drop column if exists flood_siaga_cm;
alter table public.villages drop column if exists flood_awas_cm;

commit;

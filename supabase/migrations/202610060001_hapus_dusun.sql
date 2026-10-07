-- 202610060001_hapus_dusun.sql
-- JAGA berfokus pada desa: konsep dusun dihapus. Area operasi dan alarm selalu seluruh desa.
-- Jalankan setelah 202610050001_gps_dan_sinyal.sql. Aman dijalankan ulang.
-- PERHATIAN: menghapus tabel hamlets dan kolom hamlet_id / hamlet_ids (data dusun hilang; seed hanya dummy).

begin;

-- View lama merujuk hamlet_id; tidak dipakai backend, jadi dihapus (dapat dibuat ulang tanpa kolom dusun bila perlu).
drop view if exists public.resident_support_profiles;

alter table public.residents drop column if exists hamlet_id;
alter table public.operations drop column if exists hamlet_ids;
alter table public.operations alter column area_type set default 'DESA';
update public.operations set area_type = 'DESA' where area_type <> 'DESA';

drop table if exists public.hamlets cascade;
alter table public.villages drop column if exists hamlet_count;

commit;

-- 202610100001_pengumuman_dan_kepala_desa.sql
-- Pengumuman Pusat dapat ditujukan ke desa tertentu (null = semua desa).
-- Kontak kepala desa dikelola JAGA Pusat dan dipakai saat mengirim pengumuman
-- atau menghubungi desa. Aman dijalankan ulang.

begin;

-- Tujuan pengumuman: array UUID desa; NULL berarti seluruh desa.
alter table public.announcements add column if not exists village_ids uuid[];
create index if not exists announcements_village_ids_idx on public.announcements using gin (village_ids);

-- Kontak kepala desa dihuni dan diubah oleh JAGA Pusat.
alter table public.villages add column if not exists head_name text;
alter table public.villages add column if not exists head_phone text;

-- Kolom baru pada tabel lama tetap hanya dapat diakses service_role (backend).
revoke all on public.announcements, public.villages from anon, authenticated;
grant all on public.announcements, public.villages to service_role;

commit;
-- 202610030001_prioritas.sql
-- Data terstruktur untuk prioritas penyelamatan: kemampuan evakuasi mandiri dan ketergantungan medis mendesak.
-- Dipakai mesin rekomendasi (menggantikan tebakan dari teks bebas). Jalankan setelah 202610020002_operasi.sql. Aman diulang.

begin;

alter table public.residents add column if not exists evacuation_ability text
  check (evacuation_ability is null or evacuation_ability in ('MANDIRI', 'PERLU_BANTUAN', 'TIDAK_BISA_SENDIRI'));
alter table public.residents add column if not exists time_critical_medical boolean not null default false;

comment on column public.residents.evacuation_ability is 'Diisi petugas desa: MANDIRI | PERLU_BANTUAN | TIDAK_BISA_SENDIRI';
comment on column public.residents.time_critical_medical is 'Kebutuhan medis yang tidak dapat ditunda: insulin, oksigen, dialisis, kehamilan mendekati persalinan';

commit;

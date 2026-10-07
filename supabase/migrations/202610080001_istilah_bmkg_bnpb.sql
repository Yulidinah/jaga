-- 202610080001_istilah_bmkg_bnpb.sql
-- Istilah tingkat peringatan mengikuti BMKG/BNPB: Normal, Waspada, Siaga, Awas.
-- Jalankan SENDIRIAN (tanpa BEGIN) setelah 202610070001_pusat_kendala_kalung.sql. Aman dijalankan ulang.

do $$
begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'alert_severity' and e.enumlabel = 'EVAKUASI') then
    alter type public.alert_severity rename value 'EVAKUASI' to 'AWAS';
  end if;
end $$;

-- Status penanganan tambahan untuk JAGA Rescue (SRS FR-3.6): tidak ditemukan dan tidak terjangkau.
alter type public.incident_status add value if not exists 'NOT_FOUND';
alter type public.incident_status add value if not exists 'UNREACHABLE';

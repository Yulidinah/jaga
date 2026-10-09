-- Pengumuman bisa berasal dari JAGA Pusat (ke Desa dan Rescue) atau JAGA Desa (diteruskan ke Rescue).
begin;

alter table public.announcements add column if not exists source_role text not null default 'PUSAT';
alter table public.announcements drop constraint if exists announcements_source_role_check;
alter table public.announcements add constraint announcements_source_role_check check (source_role in ('PUSAT', 'DESA'));

commit;

alter table public.settings add column if not exists source_map jsonb not null default '{}'::jsonb;

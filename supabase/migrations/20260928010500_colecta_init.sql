create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  net text not null check (net in ('facebook','instagram','youtube')),
  collection text not null,
  url text not null,
  video_id text,
  title text default '',
  author text default '',
  body text default '',
  hashtags text[] not null default '{}',
  thumb text,
  saved_at timestamptz,
  enriched boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, net, url, collection)
);
create index items_user_idx on public.items(user_id);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  synonyms text not null default '',
  yt_key text,
  meta_token text,
  updated_at timestamptz not null default now()
);

alter table public.items enable row level security;
alter table public.settings enable row level security;

create policy "items_select_own" on public.items for select to authenticated using ((select auth.uid()) = user_id);
create policy "items_insert_own" on public.items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "items_update_own" on public.items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "items_delete_own" on public.items for delete to authenticated using ((select auth.uid()) = user_id);

create policy "settings_select_own" on public.settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings_insert_own" on public.settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "settings_update_own" on public.settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "settings_delete_own" on public.settings for delete to authenticated using ((select auth.uid()) = user_id);

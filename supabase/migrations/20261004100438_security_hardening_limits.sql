-- 9. Permisos mínimos
revoke all on table public.items, public.settings from anon;
revoke truncate, references, trigger on table public.items, public.settings from authenticated;

-- Marca de texto recortado
alter table public.items add column if not exists truncated boolean not null default false;

-- Conservar hashtags del texto completo antes de recortar
update public.items i set
  hashtags = (select coalesce(array_agg(t), '{}') from (select distinct t from unnest(i.hashtags || coalesce((select array_agg(lower(m[1])) from regexp_matches(i.body, '(#[[:alnum:]_]+)', 'g') m), '{}')) t where length(t) <= 100 limit 60) s),
  body = left(i.body, 2000),
  truncated = true
where length(i.body) > 2000;

update public.items set hashtags = hashtags[1:60] where cardinality(hashtags) > 60;

-- 3. Límites por campo
alter table public.items
  add constraint items_net_chk check (net in ('instagram','facebook','youtube')),
  add constraint items_url_chk check (length(url) <= 2048 and url ~* '^https?://'),
  add constraint items_thumb_chk check (thumb is null or (length(thumb) <= 2048 and thumb ~* '^https?://')),
  add constraint items_collection_chk check (length(collection) between 1 and 100),
  add constraint items_title_chk check (length(coalesce(title,'')) <= 500),
  add constraint items_author_chk check (length(coalesce(author,'')) <= 200),
  add constraint items_body_chk check (length(coalesce(body,'')) <= 2000),
  add constraint items_tags_chk check (cardinality(hashtags) <= 60 and length(array_to_string(hashtags, ' ')) <= 6000),
  add constraint items_video_chk check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');

alter table public.settings
  add constraint settings_syn_chk check (length(synonyms) <= 20000),
  add constraint settings_yt_chk check (yt_key is null or length(yt_key) <= 200),
  add constraint settings_meta_chk check (meta_token is null or length(meta_token) <= 600),
  add constraint settings_map_chk check (pg_column_size(source_map) <= 262144);

-- 3. Máximo de elementos por usuario
create or replace function public.enforce_item_quota() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.items where user_id = auth.uid()) > 5000 then
    raise exception 'colecta_limit: maximo 5000 elementos por usuario' using errcode = 'P0001';
  end if;
  return null;
end $$;
revoke execute on function public.enforce_item_quota() from public, anon, authenticated;

drop trigger if exists items_quota on public.items;
create trigger items_quota after insert on public.items for each statement execute function public.enforce_item_quota();

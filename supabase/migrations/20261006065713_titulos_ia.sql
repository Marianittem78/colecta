-- Títulos cortos escritos por IA (los completa la función «titulos»)
alter table public.items add column if not exists short_title text;
alter table public.items add constraint items_short_title_chk check (short_title is null or length(short_title) between 1 and 120);

-- Cupo diario de títulos por persona: solo lo toca la función con la clave secreta
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  titles integer not null default 0 check (titles >= 0),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;

-- Suma n títulos al día de hoy si no supera el cupo (n negativo devuelve lo que no se usó)
create or replace function public.take_title_quota(uid uuid, n integer, cap integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare used integer;
begin
  if uid is null or n is null or n = 0 or abs(n) > 100 then return false; end if;
  insert into public.ai_usage as u (user_id, day, titles) values (uid, current_date, greatest(n, 0))
  on conflict (user_id, day) do update set titles = greatest(u.titles + n, 0)
  where u.titles + n <= cap
  returning u.titles into used;
  return used is not null;
end $$;
revoke execute on function public.take_title_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.take_title_quota(uuid, integer, integer) to service_role;

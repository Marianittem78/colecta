-- Threads como cuarta red (se comparte de a una publicación desde la app de Android).
-- Había dos restricciones iguales sobre net: la de la tabla original y la de security_hardening_limits.
alter table public.items
  drop constraint if exists items_net_check,
  drop constraint if exists items_net_chk,
  add constraint items_net_chk check (net in ('instagram','facebook','threads','youtube'));

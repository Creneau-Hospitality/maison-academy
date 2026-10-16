-- Maison Academy · Phase 1 · make David the first admin.
-- Run after David has created his login in Supabase (Authentication > Users).
insert into public.app_users (user_id, email, display_name)
select id, lower(email), 'David' from auth.users where lower(email) = 'david@swrhospitality.com'
on conflict (user_id) do update set active = true;

insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where lower(email) = 'david@swrhospitality.com'
on conflict (user_id, role) do nothing;

select u.email, r.role from public.app_users u join public.user_roles r using (user_id);

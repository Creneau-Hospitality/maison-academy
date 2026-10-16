-- Maison Academy · Phase 1 · Content studio
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Creates: app_users, user_roles, tracks, units, cards, card_versions,
-- settings, audit_log, plus the rules that protect them.
--
-- Rules the database enforces (not just the screen):
--   * Only admins and content reviewers can read or change cards.
--   * Reviewers can only approve or edit cards in their own tracks.
--   * A card can only be live with a named reviewer.
--   * An allergen card can only be live after a kitchen check, recorded by
--     someone marked as an allergen checker (decision of 16 Oct 2026).
--   * Editing a card's content creates a new version and sends it back to
--     review. History is kept in card_versions.
--   * New and imported cards always arrive as draft or review.
--   * Approvals, retirements, kitchen checks, imports and role changes are
--     written to audit_log.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- People and roles
-- ---------------------------------------------------------------------------

create table if not exists public.app_users (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  display_name     text not null,
  allergen_checker boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id    uuid not null references public.app_users(user_id) on delete cascade,
  role       text not null check (role in ('admin', 'reviewer', 'venue_manager', 'staff')),
  -- reviewer: which tracks they may edit and approve (null = none)
  tracks     text[],
  -- venue_manager: which venue (used from Phase 3)
  venue_id   text,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Helper checks. security definer so they can read the role tables even
-- though those tables are themselves protected.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles r join app_users u using (user_id)
    where r.user_id = auth.uid() and r.role = 'admin' and u.active
  );
$$;

create or replace function public.is_reviewer_for(p_track text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from user_roles r join app_users u using (user_id)
    where r.user_id = auth.uid() and r.role = 'reviewer' and u.active
      and p_track = any(coalesce(r.tracks, '{}'))
  );
$$;

create or replace function public.is_content_user() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from user_roles r join app_users u using (user_id)
    where r.user_id = auth.uid() and r.role = 'reviewer' and u.active
  );
$$;

create or replace function public.is_allergen_checker() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users where user_id = auth.uid() and active and allergen_checker
  );
$$;

create or replace function public.current_display_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from app_users where user_id = auth.uid()), 'System');
$$;

-- ---------------------------------------------------------------------------
-- Content structure
-- ---------------------------------------------------------------------------

create table if not exists public.tracks (
  id   text primary key,
  name text not null,
  sort int  not null default 0
);

create table if not exists public.units (
  id       text primary key,
  track_id text not null references public.tracks(id),
  name     text not null,
  sort     int  not null default 0
);

create table if not exists public.cards (
  id                  text primary key,
  track_id            text not null references public.tracks(id),
  unit_id             text not null references public.units(id),
  level               smallint not null check (level between 1 and 3),
  roles               text[] not null default '{}',
  type                text not null check (type in ('mcq', 'multi', 'order', 'image', 'scenario')),
  prompt              text not null,
  media               text,
  options             jsonb not null default '[]',
  answer              jsonb not null default '[]',
  explanation         text not null default '',
  why_it_matters      text not null default '',
  is_allergen         boolean not null default false,
  source_ref          text not null default '',
  review_note         text,
  status              text not null default 'review'
                        check (status in ('draft', 'review', 'live', 'retired')),
  reviewed_by         text,
  reviewed_at         timestamptz,
  allergen_check_by   text,
  allergen_checked_at timestamptz,
  version             int not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          text,
  constraint live_needs_reviewer check (status <> 'live' or reviewed_by is not null),
  constraint live_allergen_needs_kitchen_check
    check (status <> 'live' or not is_allergen or allergen_check_by is not null),
  constraint options_is_list check (jsonb_typeof(options) = 'array'),
  constraint answer_is_list  check (jsonb_typeof(answer) = 'array')
);

create index if not exists cards_track_status on public.cards (track_id, status);
create index if not exists cards_unit on public.cards (unit_id);

create table if not exists public.card_versions (
  card_id     text not null references public.cards(id) on delete cascade,
  version     int  not null,
  snapshot    jsonb not null,
  saved_by    text,
  saved_at    timestamptz not null default now(),
  primary key (card_id, version)
);

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor_id  uuid,
  actor     text,
  action    text not null,
  entity    text not null,
  entity_id text,
  detail    jsonb
);

-- ---------------------------------------------------------------------------
-- Card rules (versions, approvals, kitchen check)
-- ---------------------------------------------------------------------------

create or replace function public.card_content(c public.cards) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'track_id', c.track_id, 'unit_id', c.unit_id, 'level', c.level, 'roles', c.roles,
    'type', c.type, 'prompt', c.prompt, 'media', c.media, 'options', c.options,
    'answer', c.answer, 'explanation', c.explanation, 'why_it_matters', c.why_it_matters,
    'is_allergen', c.is_allergen, 'source_ref', c.source_ref
  );
$$;

create or replace function public.cards_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := public.current_display_name();
  is_server boolean := auth.uid() is null;   -- SQL editor or service role
begin
  if tg_op = 'INSERT' then
    if not is_server then
      if not public.is_reviewer_for(new.track_id) then
        raise exception 'You can only add cards to your own tracks.';
      end if;
      -- New and imported cards always start in draft or review.
      if new.status not in ('draft', 'review') then new.status := 'review'; end if;
      new.reviewed_by := null;  new.reviewed_at := null;
      new.allergen_check_by := null;  new.allergen_checked_at := null;
      new.version := 1;
    end if;
    new.updated_by := coalesce(new.updated_by, who);
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if is_server then
    new.updated_at := now();
    if public.card_content(new) is distinct from public.card_content(old) then
      new.version := old.version + 1;
    end if;
    return new;
  end if;

  if not public.is_reviewer_for(old.track_id) or not public.is_reviewer_for(new.track_id) then
    raise exception 'You can only change cards in your own tracks.';
  end if;

  -- Sign-off fields can't be typed in; they're set below.
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.version := old.version;

  -- Kitchen check: only someone marked as an allergen checker can record it.
  if new.allergen_check_by is distinct from old.allergen_check_by then
    if new.allergen_check_by is null then
      new.allergen_checked_at := null;           -- clearing is allowed
    elsif public.is_allergen_checker() then
      new.allergen_check_by := who;
      new.allergen_checked_at := now();
    else
      raise exception 'Only a kitchen allergen checker can record the allergen check.';
    end if;
  else
    new.allergen_checked_at := old.allergen_checked_at;
  end if;

  -- Content changed: new version, back to review, sign-offs cleared.
  if public.card_content(new) is distinct from public.card_content(old) then
    new.version := old.version + 1;
    if new.status <> 'retired' and new.status <> 'draft' then new.status := 'review'; end if;
    new.reviewed_by := null;  new.reviewed_at := null;
    if new.is_allergen then
      new.allergen_check_by := null;  new.allergen_checked_at := null;
    end if;
  elsif new.status = 'live' and old.status <> 'live' then
    -- Approval: the approver's name is recorded.
    new.reviewed_by := who;
    new.reviewed_at := now();
  elsif new.status in ('draft', 'review') and old.status = 'live' then
    -- Sent back for another look: the old approval no longer stands.
    new.reviewed_by := null;  new.reviewed_at := null;
  end if;

  if new.is_allergen and new.status = 'live' and new.allergen_check_by is null then
    raise exception 'Allergen cards need a kitchen check before they can go live.';
  end if;

  new.updated_by := who;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.cards_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := public.current_display_name();
  act text;
begin
  -- Keep a snapshot of every version.
  insert into card_versions (card_id, version, snapshot, saved_by, saved_at)
  values (new.id, new.version, to_jsonb(new), who, now())
  on conflict (card_id, version) do update
    set snapshot = excluded.snapshot, saved_by = excluded.saved_by, saved_at = excluded.saved_at;

  if tg_op = 'INSERT' then
    act := 'card_created';
  elsif new.status is distinct from old.status and new.status = 'live' then
    act := 'card_approved';
  elsif new.status is distinct from old.status and new.status = 'retired' then
    act := 'card_retired';
  elsif new.allergen_check_by is distinct from old.allergen_check_by and new.allergen_check_by is not null then
    act := 'card_allergen_checked';
  elsif new.version <> old.version then
    act := 'card_edited';
  elsif new.status is distinct from old.status then
    act := 'card_status_' || new.status;
  else
    return null;
  end if;

  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), who, act, 'card', new.id,
          jsonb_build_object('version', new.version, 'status', new.status));
  return null;
end;
$$;

drop trigger if exists cards_before_write on public.cards;
create trigger cards_before_write before insert or update on public.cards
  for each row execute function public.cards_before_write();

drop trigger if exists cards_after_write on public.cards;
create trigger cards_after_write after insert or update on public.cards
  for each row execute function public.cards_after_write();

-- Cards are never deleted, only retired.
create or replace function public.cards_no_delete() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    raise exception 'Cards are retired, not deleted.';
  end if;
  return old;
end;
$$;
drop trigger if exists cards_no_delete on public.cards;
create trigger cards_no_delete before delete on public.cards
  for each row execute function public.cards_no_delete();

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- Give someone a role, by the email they signed up with.
create or replace function public.grant_role(
  p_email text, p_role text, p_display_name text default null,
  p_tracks text[] default null, p_allergen_checker boolean default null
) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can change roles.'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No login found for %. Invite them in Supabase first.', p_email;
  end if;
  insert into app_users (user_id, email, display_name, allergen_checker)
  values (uid, lower(trim(p_email)), coalesce(nullif(trim(p_display_name), ''), split_part(p_email, '@', 1)),
          coalesce(p_allergen_checker, false))
  on conflict (user_id) do update set
    display_name = coalesce(nullif(trim(p_display_name), ''), app_users.display_name),
    allergen_checker = coalesce(p_allergen_checker, app_users.allergen_checker),
    active = true;
  insert into user_roles (user_id, role, tracks) values (uid, p_role, p_tracks)
  on conflict (user_id, role) do update set tracks = excluded.tracks;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'role_granted', 'user', p_email,
          jsonb_build_object('role', p_role, 'tracks', p_tracks, 'allergen_checker', p_allergen_checker));
end;
$$;

create or replace function public.revoke_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can change roles.'; end if;
  if p_user = auth.uid() and p_role = 'admin' then
    raise exception 'You can''t remove your own admin role.';
  end if;
  delete from user_roles where user_id = p_user and role = p_role;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'role_revoked', 'user', p_user::text,
          jsonb_build_object('role', p_role));
end;
$$;

-- Record that an import or export happened (no card content, just totals).
create or replace function public.log_event(p_action text, p_detail jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_user() then raise exception 'Not allowed.'; end if;
  if p_action not in ('cards_imported', 'cards_exported') then raise exception 'Unknown action.'; end if;
  insert into audit_log (actor_id, actor, action, entity, detail)
  values (auth.uid(), public.current_display_name(), p_action, 'cards', p_detail);
end;
$$;

-- What the signed-in person is allowed to do (for the screen only;
-- the database rules above are what actually protect the data).
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'display_name', (select display_name from app_users where user_id = auth.uid() and active),
    'admin', public.is_admin(),
    'allergen_checker', public.is_allergen_checker(),
    'reviewer_tracks', coalesce((select tracks from user_roles where user_id = auth.uid() and role = 'reviewer'), '{}')
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.app_users     enable row level security;
alter table public.user_roles    enable row level security;
alter table public.tracks        enable row level security;
alter table public.units         enable row level security;
alter table public.cards         enable row level security;
alter table public.card_versions enable row level security;
alter table public.settings      enable row level security;
alter table public.audit_log     enable row level security;

drop policy if exists app_users_read on public.app_users;
create policy app_users_read on public.app_users for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists app_users_admin on public.app_users;
create policy app_users_admin on public.app_users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists tracks_read on public.tracks;
create policy tracks_read on public.tracks for select to authenticated using (public.is_content_user());
drop policy if exists tracks_admin on public.tracks;
create policy tracks_admin on public.tracks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists units_read on public.units;
create policy units_read on public.units for select to authenticated using (public.is_content_user());
drop policy if exists units_write on public.units;
create policy units_write on public.units for insert to authenticated
  with check (public.is_reviewer_for(track_id));
drop policy if exists units_update on public.units;
create policy units_update on public.units for update to authenticated
  using (public.is_reviewer_for(track_id)) with check (public.is_reviewer_for(track_id));

drop policy if exists cards_read on public.cards;
create policy cards_read on public.cards for select to authenticated using (public.is_content_user());
drop policy if exists cards_insert on public.cards;
create policy cards_insert on public.cards for insert to authenticated
  with check (public.is_reviewer_for(track_id));
drop policy if exists cards_update on public.cards;
create policy cards_update on public.cards for update to authenticated
  using (public.is_reviewer_for(track_id)) with check (public.is_reviewer_for(track_id));

drop policy if exists card_versions_read on public.card_versions;
create policy card_versions_read on public.card_versions for select to authenticated
  using (public.is_content_user());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (public.is_content_user());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
grant select, insert, update on public.cards, public.units to authenticated;
grant select on public.app_users, public.user_roles, public.tracks, public.card_versions,
  public.settings, public.audit_log to authenticated;
grant update on public.app_users, public.settings to authenticated;
grant insert, update, delete on public.tracks to authenticated;

-- ---------------------------------------------------------------------------
-- Tracks, units and settings
-- ---------------------------------------------------------------------------

insert into public.tracks (id, name, sort) values
  ('service',    'Sequence of service', 1),
  ('food',       'Food menu',           2),
  ('drinks',     'Drinks',              3),
  ('upselling',  'Upselling',           4),
  ('suggestive', 'Suggestive selling',  5),
  ('sop',        'SOPs',                6)
on conflict (id) do update set name = excluded.name, sort = excluded.sort;

insert into public.units (id, track_id, name, sort) values
  ('host-sequence',          'service', 'Host sequence',               1),
  ('waiter-sequence',        'service', 'Waiter sequence',             2),
  ('runner-sequence',        'service', 'Food runner sequence',        3),
  ('barista-sequence',       'service', 'Barista sequence',            4),
  ('timing-standards',       'service', 'Timing standards',            5),
  ('menu-basics',            'food',    'Menu basics',                 1),
  ('breakfast',              'food',    'Breakfast',                   2),
  ('lunch-dinner',           'food',    'Lunch and dinner',            3),
  ('allergens-breakfast',    'food',    'Allergens: breakfast',        4),
  ('allergens-lunch-dinner', 'food',    'Allergens: lunch and dinner', 5),
  ('bar-standards',          'drinks',  'Bar standards',               1),
  ('spirits-wine-basics',    'drinks',  'Spirits and wine basics',     2),
  ('beer',                   'drinks',  'Beer',                        3),
  ('cocktails',              'drinks',  'Cocktails',                   4),
  ('mocktails-soft',         'drinks',  'Mocktails and soft drinks',   5),
  ('coffee-tea',             'drinks',  'Coffee and tea',              6),
  ('allergen-protocol',      'sop',     'Allergen protocol',           1),
  ('guest-recovery',         'sop',     'Guest recovery',              2),
  ('house-standards',        'sop',     'House standards',             3),
  ('opening-closing',        'sop',     'Opening and closing',         4),
  ('controls',               'sop',     'Controls',                    5),
  ('safety-basics',          'sop',     'Safety basics',               6)
on conflict (id) do nothing;

insert into public.settings (key, value, note) values
  ('weekly_target_default',  '4',  'Sets per week, default for each person'),
  ('venue_weekly_goal_pct',  '85', 'Share of staff meeting their weekly target'),
  ('leitner_gaps_days',      '{"1": 0, "2": 1, "3": 3, "4": 7, "5": 21, "6": 45}', 'Days until the next review, by box'),
  ('allergen_max_box',       '5',  'Allergen cards never go above this box'),
  ('level1_mastery_pct',     '80', 'Mastery of Level 1 scope to reach Level 1'),
  ('readiness_check_cards',  '20', 'Cards in the readiness check'),
  ('readiness_pass_pct',     '80', 'Readiness check: share right to pass'),
  ('level2_mastery_pct',     '70', 'Mastery in every track to reach Level 2'),
  ('badge_mastery_pct',      '90', 'Mastery for a Level 3 badge'),
  ('addon_min_guests',       '150','Guests in the period before an add-on rate is shown'),
  ('baseline_weeks',         '8',  'Weeks before launch used as the sales baseline'),
  ('leaver_anonymise_months','12', 'Months after leaving before a record is anonymised')
on conflict (key) do nothing;

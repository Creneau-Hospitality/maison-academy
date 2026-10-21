-- Maison Academy · 0018 reminder schedule
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Calls the "reminders" Edge Function every 15 minutes. The function asks the
-- database who is due (svc_due_reminders), so this schedule carries no secret
-- and calling it more often than needed is harmless: nobody gets more than one
-- reminder a day, and while reminders_mode is "test" only test accounts can
-- receive one. To pause everything, set reminders_mode to "off" in Settings.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'maison-reminders';

select cron.schedule(
  'maison-reminders',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := 'https://dxipjlkledacoabdhrdg.supabase.co/functions/v1/reminders',
      body := '{"action":"run"}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);

select jobname, schedule, active from cron.job where jobname = 'maison-reminders';

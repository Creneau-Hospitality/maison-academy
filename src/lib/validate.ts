import type { Card } from './types';

export interface Check {
  /** Can't be saved until fixed. */
  errors: string[];
  /** Can be saved, but can't go live until fixed. */
  blockers: string[];
  /** Worth a look; nothing is stopped. */
  warnings: string[];
}

// Words the brief never uses about people (section 3). On a card they may be
// fine ("a bad smell"), so they only raise a warning.
const PEOPLE_WORDS = /\b(wrong|fail|failed|weak|poor|bad|behind)\b/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) => s.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length;

export function checkCard(c: Card): Check {
  const errors: string[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const opts = c.options.map((o) => o.trim());
  const ans = c.answer.map((a) => a.trim());

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) errors.push('Card ID: lower-case letters, numbers and dashes only.');
  if (!c.track_id) errors.push('Choose a track.');
  if (!c.unit_id) errors.push('Choose a unit.');
  if (![1, 2, 3].includes(Number(c.level))) errors.push('Level must be 1, 2 or 3.');
  if (!c.prompt.trim()) errors.push('The question is empty.');
  if (opts.length < 2) errors.push('Add at least two options.');
  if (opts.some((o) => !o)) errors.push('One of the options is empty.');
  if (new Set(opts).size !== opts.length) errors.push('Two options are the same.');
  if (ans.length === 0) errors.push('Mark the right answer.');
  if (ans.some((a) => !opts.includes(a))) errors.push('The right answer must be one of the options.');

  if (['mcq', 'scenario', 'image'].includes(c.type) && ans.length > 1)
    errors.push('This card type has exactly one right answer.');
  if (c.type === 'order' && (ans.length !== opts.length || new Set(ans).size !== ans.length))
    errors.push('The right order must use every step once.');
  if (c.type === 'image' && !c.media?.trim()) blockers.push('Photo cards need a photo.');
  if (c.type === 'multi' && ans.length === opts.length) warnings.push('Every option is right; add a plausible distractor.');

  if (!c.explanation.trim()) blockers.push('Add an explanation.');
  if (!c.why_it_matters.trim()) blockers.push('Add "why it matters on the floor".');
  if (!c.source_ref.trim()) blockers.push('Add the source (file and section).');
  if (c.roles.length === 0) blockers.push('Tag at least one role.');

  const all = [c.prompt, ...opts, c.explanation, c.why_it_matters].join(' ');
  if (/\[TO CONFIRM\]/i.test(all)) blockers.push('Still has [TO CONFIRM] in it.');

  if (words(c.prompt) > 25) warnings.push(`Question is ${words(c.prompt)} words; aim for under 25.`);
  if (sentences(c.explanation) > 2) warnings.push('Explanation is over two sentences.');
  if (sentences(c.why_it_matters) > 1) warnings.push('"Why it matters" is over one sentence.');
  if (PEOPLE_WORDS.test(all)) warnings.push('Uses a word the house style avoids about people (wrong, fail, weak, poor, bad, behind). Fine if it isn\'t about a person.');
  if (/\bnot\b.*\bnot\b/i.test(c.prompt) || /\bnever\b.*\bnot\b/i.test(c.prompt)) warnings.push('Question may have a double negative.');

  return { errors, blockers, warnings };
}

export function canGoLive(c: Card): string[] {
  const k = checkCard(c);
  const reasons = [...k.errors, ...k.blockers];
  if (c.is_allergen && !c.allergen_check_by) reasons.push('Allergen card: needs the kitchen check first.');
  return reasons;
}

/* Questions buyers ask, answered by Ask Poko and listed beside it. Scripted: this page
   never calls a model. `section` is where "Take me there" goes. */
export type Faq = { q: string; a: string; keys: string[]; section?: string };

export const FAQ: Faq[] = [
  {
    q: 'Doesn’t Claude already do this?',
    a: 'For one user, once. What Claude, ChatGPT or Comet works out in your product stays in one person’s chat, and your user pays for it. Poko learns from all of your users and keeps what it learns in your product, so the next user gets it for free.',
    keys: ['claude', 'chatgpt', 'comet', 'agent', 'agents', 'browser', 'operator', 'atlas', 'computer use', 'already', 'gpt', 'gemini', 'copilot'],
    section: 'why',
  },
  {
    q: 'How is this different from product tours?',
    a: 'Tours are scripted by your team, point at buttons, and break when your UI ships. Poko learns from how people actually use your product, does the steps with your users, and relearns on every release.',
    keys: ['tour', 'tours', 'walkthrough', 'onboarding tool', 'different', 'pendo', 'appcues', 'walkme', 'whatfix', 'userpilot', 'dap'],
    section: 'why',
  },
  {
    q: 'We already have a help-center chatbot. Why Poko?',
    a: 'Keep it for billing and refunds. A chatbot answers with a list of steps, and your user still has to find every button. Poko reads the same help center and does the steps with them, inside the product.',
    keys: ['chatbot', 'chat bot', 'bot', 'intercom', 'fin', 'zendesk', 'help center', 'helpdesk', 'support bot'],
    section: 'why',
  },
  {
    q: 'Can it click things for my users?',
    a: 'Yes, with a yes. Poko handles the clicks and the boring fields, and stops at every decision for your user’s approval. Nothing happens without it.',
    keys: ['click', 'act', 'action', 'approve', 'do it', 'automate', 'control', 'autonomous'],
    section: 'top',
  },
  {
    q: 'What happens when our UI changes?',
    a: 'Poko keeps watching, so new paths show up on their own. If a workflow it knows stops working, it tells you and relearns it from the next sessions.',
    keys: ['change', 'changes', 'redesign', 'update', 'break', 'ui', 'new version', 'release'],
    section: 'how',
  },
  {
    q: 'Is our customers’ data safe?',
    a: 'Typed data never leaves the browser, page text stays hidden unless many users see it, recording can wait for your consent banner, and Global Privacy Control is respected. Every action Poko takes is logged.',
    keys: ['data', 'safe', 'privacy', 'private', 'secure', 'security', 'gdpr', 'pii', 'mask', 'record', 'consent', 'soc', 'audit', 'log'],
  },
  {
    q: 'Which model does it use?',
    a: 'Your call: Poko’s model on credits, your own key for any major provider, or your own model on your own servers. Switch any time. No lock-in.',
    keys: ['model', 'llm', 'key', 'openai', 'anthropic', 'ollama', 'local', 'byok', 'on-prem', 'premise', 'self-host', 'lock'],
  },
  {
    q: 'What does it cost?',
    a: 'Nothing during the beta, including model credits. Premium, which removes the badge, is priced before the beta ends. Enterprise terms are custom.',
    keys: ['cost', 'price', 'pricing', 'free', 'pay', 'premium', 'beta', 'plan', 'money', 'credits', 'enterprise'],
    section: 'pricing',
  },
  {
    q: 'Do we still need our docs, training and support?',
    a: 'Keep your docs: Poko learns from them, and tells you when one stops matching the product. Your users stop needing the course and the queue for “how do I” questions. Your support team keeps the hard ones.',
    keys: ['replace', 'docs', 'documentation', 'training', 'support team', 'support', 'manual', 'course', 'still need'],
    section: 'problem',
  },
  {
    q: 'Will it work on a product as complex as ours?',
    a: 'That’s who it’s for. The more paths your product has, the more a guide helps, and Poko learns them from real usage instead of a script. Start with the workflows your users ask about most.',
    keys: ['complex', 'complicated', 'big', 'enterprise', 'our product', 'platform', 'cloud', 'console', 'scale'],
    section: 'problem',
  },
  {
    q: 'Do I need to script anything?',
    a: 'No. Add one line and Poko starts learning. You approve workflows in one click or show one in Teach mode, but you never write a tour.',
    keys: ['script', 'setup', 'set up', 'install', 'configure', 'code', 'line', 'start', 'integrate'],
    section: 'how',
  },
  {
    q: 'How long does learning take?',
    a: 'It depends on your traffic: busy products learn faster. The learning score shows progress, and you choose when each workflow goes live.',
    keys: ['long', 'time', 'week', 'days', 'learn', 'fast', 'score', 'quick'],
    section: 'team',
  },
  {
    q: 'Can it match our brand?',
    a: 'Yes. Floating chat or side panel, with your colors, your font and your name for it.',
    keys: ['brand', 'color', 'style', 'theme', 'look', 'design', 'panel', 'widget', 'custom', 'font', 'name'],
  },
];

export const SUGGESTED = ['Doesn’t Claude already do this?', 'Different from product tours?', 'Is our data safe?', 'Which model?'];

/* Typed into the empty Ask field, one after another. */
export const HINTS = [
  'Doesn’t Claude already do this?',
  'Will it work on a product as complex as ours?',
  'We already have a chatbot. Why Poko?',
  'What happens when our UI changes?',
];

/* A small keyword match. Good enough for a scripted page, and honest about it. */
export function answer(query: string): Faq | null {
  const q = query.toLowerCase();
  let best: Faq | null = null;
  let bestScore = 0;
  for (const item of FAQ) {
    let score = 0;
    for (const k of item.keys) if (q.includes(k)) score += k.length > 4 ? 2 : 1;
    for (const word of item.q.toLowerCase().split(/\W+/)) if (word.length > 3 && q.includes(word)) score += 1;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore > 1 ? best : null;
}

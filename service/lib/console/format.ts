/* Times and counts as the console shows them, formatted on the server so the page
   reads the same before and after it becomes interactive. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function when(at: number | null | undefined, now = Date.now()): string {
  if (!at) return '';
  const d = new Date(at);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === n.toDateString()) return hm;
  const y = new Date(now - 86_400_000);
  if (d.toDateString() === y.toDateString()) return `yesterday ${hm}`;
  const t = new Date(now + 86_400_000);
  if (d.toDateString() === t.toDateString()) return `tomorrow ${hm}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${hm}`;
}

export function ago(at: number | null | undefined, now = Date.now()): string {
  if (!at) return 'never';
  const s = Math.round((now - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* node:sqlite returns rows with a null prototype, which React refuses to pass to a
   client component. Everything crossing that boundary goes through this. */
export function plain<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

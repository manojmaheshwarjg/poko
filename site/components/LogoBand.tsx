import { BrandLogo, logoLabel, type LogoName } from './BrandLogo';

/* Under the hero, what Poko works with, in three short groups: your stack, your docs and
   your model. It holds still; hover a logo and Poko says its name. */
const GROUPS: [string, LogoName[]][] = [
  ['Your stack', ['react', 'nextjs', 'vue', 'angular', 'svelte']],
  ['Your docs', ['notion', 'confluence', 'zendesk', 'intercom', 'gitbook']],
  ['Your model', ['openai', 'anthropic', 'gemini', 'mistral', 'ollama']],
];

export function LogoBand() {
  return (
    <section className="logo-band" aria-label="Works with your stack, your docs and your model">
      <div className="wrap lb-in">
        {GROUPS.map(([label, names]) => (
          <div className="lb-group" key={label}>
            <p className="tag">{label}</p>
            <ul className="lb-logos">
              {names.map((n) => (
                <li key={n} data-say={logoLabel(n)}>
                  <BrandLogo name={n} size={24} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

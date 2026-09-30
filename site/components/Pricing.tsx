import { Icon } from './Icon';
import { SectionHead } from './SectionHead';

/* 06, pricing: free while in beta, said plainly. Beta is the one to pick today; Premium
   and Enterprise say what's coming without inventing numbers. */
type Plan = {
  name: string;
  price: string;
  note: string;
  items: string[];
  more?: string;
  cta: string;
  hot?: boolean;
  say: string;
};

const PLANS: Plan[] = [
  {
    name: 'Beta',
    price: '$0',
    note: 'for every team in the beta',
    items: ['Every feature', 'Model credits included', 'Or your own key or model', 'Poko badge on the widget'],
    cta: 'Get early access',
    hot: true,
    say: 'this one!',
  },
  {
    name: 'Premium',
    price: 'Later',
    note: 'priced before the beta ends',
    items: ['Everything in Beta', 'No Poko badge'],
    more: 'More details soon',
    cta: 'Join the list',
    say: 'coming soon',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    note: 'for regulated teams',
    items: ['Your model, on your servers', 'Security review support', 'Custom terms'],
    cta: 'Talk to us',
    say: 'let’s talk',
  },
];

const EVERY = ['Masking on the page', 'Approvals', 'Action log', 'Your model or ours'];

export function Pricing() {
  return (
    <section
      className="section pricing"
      id="pricing"
      aria-labelledby="pricing-title"
      data-zone
      data-zone-mood="happy"
      data-zone-hat="true"
      data-zone-say="it’s free!"
    >
      <div className="wrap">
        <SectionHead n="06" label="Pricing" id="pricing-title" title="Free while we’re in beta." quiet="No card now. No lock-in, ever." />
        <div className="pr-grid">
          {PLANS.map((p) => (
            <article className={`pr-plan${p.hot ? ' hot' : ''}`} key={p.name} aria-labelledby={`plan-${p.name}`}>
              <p className="pr-name">
                <b id={`plan-${p.name}`}>{p.name}</b>
                {p.hot ? <span className="pr-now">Now</span> : null}
              </p>
              <p className={`pr-price${p.hot ? '' : ' soft'}`}>{p.price}</p>
              <p className="pr-note">{p.note}</p>
              <ul className="pr-items">
                {p.items.map((it) => (
                  <li key={it}>
                    <Icon name="check" size={15} />
                    {it}
                  </li>
                ))}
                {p.more ? <li className="more">{p.more}</li> : null}
              </ul>
              <a className={`btn ${p.hot ? 'btn-brand' : 'btn-soft'} pr-cta`} href="#join" data-say={p.say}>
                {p.cta}
              </a>
            </article>
          ))}
        </div>
        <p className="pr-every">
          <span className="tag">Every plan:</span>
          {EVERY.map((e) => (
            <span key={e}>
              <Icon name="check" size={14} />
              {e}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

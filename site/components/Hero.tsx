import { BrowserFrame } from './BrowserFrame';
import { CommandPill } from './CommandPill';
import { HeroArrow } from './HeroArrow';
import { HeroConsole } from './HeroConsole';

/* The hero: a short two-tone headline and the call to action on the left, and Poko on
   the right as a 3D arrow drawn in gradient edges. Below, the live console in a Mac
   Chrome window, cut at three quarters, with the arrow's tail running behind it. */
export function Hero() {
  return (
    <section
      className="hero seen"
      id="top"
      aria-labelledby="hero-title"
      data-zone
      data-zone-mood="happy"
      data-zone-say="hi! I’m Poko."
    >
      <HeroArrow />
      <div className="wrap">
        <div className="hero-in">
          <h1 className="h1 hero-title rise" id="hero-title">
            Your users shouldn’t need training to use your product.{' '}
            <span className="q">Poko is an AI guide that does the hard parts with them.</span>
          </h1>
          <div className="hero-ctas rise" style={{ ['--i' as string]: 1 }}>
            <a className="btn btn-brand" href="#join" data-poko-point data-say="one click. promise.">
              Get early access
            </a>
            <CommandPill />
          </div>
        </div>

        <figure
          className="hero-art rise"
          style={{ ['--i' as string]: 2 }}
          aria-label="Live demo: Acme Cloud is made up. Poko does the clicks, and stops twice for a yes."
        >
          <div className="hero-window">
            <BrowserFrame host="console.acmecloud.com" path="/iam/users" title="Users · Acme Cloud Console">
              <HeroConsole />
            </BrowserFrame>
          </div>
        </figure>
      </div>
    </section>
  );
}

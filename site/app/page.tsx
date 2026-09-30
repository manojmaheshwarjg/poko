import { Buddy } from '@/components/Buddy';
import { Faq } from '@/components/Faq';
import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { LogoBand } from '@/components/LogoBand';
import { ScrollFX } from '@/components/motion/ScrollFX';
import { SmoothScroll } from '@/components/motion/SmoothScroll';
import { Nav } from '@/components/Nav';
import { Pricing } from '@/components/Pricing';
import { Problem } from '@/components/Problem';
import { Reveal } from '@/components/Reveal';
import { Shortcuts } from '@/components/Shortcuts';
import { TeamConsole } from '@/components/TeamConsole';
import { WhyPoko } from '@/components/WhyPoko';

/* One story, one look: the promise and a live demo, what Poko works with, the problem,
   how it works, the console your team uses, why Poko wins, what it costs, and questions.
   On a desktop, Poko is your cursor the whole way down. */
export default function Home() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SmoothScroll />
      <Shortcuts />
      <Nav />
      <main id="main">
        <Hero />
        <LogoBand />
        <Problem />
        <HowItWorks />
        <TeamConsole />
        <WhyPoko />
        <Pricing />
        <Faq />
      </main>
      <Footer />
      <Buddy />
      <Reveal />
      <ScrollFX />
    </>
  );
}

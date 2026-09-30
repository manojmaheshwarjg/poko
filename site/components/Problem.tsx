'use client';

import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import { LogoMark } from './LogoMark';
import { SectionHead } from './SectionHead';

/* 01, the problem, told as a route. A new user wanders from a training course to a docs
   page to a support ticket, and one task takes three days. Poko's route is the short
   violet line underneath: two minutes, inside the product. Illustrative. */
const at = (i: number) => ({ '--i': i }) as CSSProperties;

export function Problem() {
  return (
    <section
      className="section alt problem"
      id="problem"
      aria-labelledby="problem-title"
      data-zone
      data-zone-mood="confused"
      data-zone-say="day three?!"
    >
      <div className="wrap">
        <div className="pb-head">
          <SectionHead
            n="01"
            label="The problem"
            id="problem-title"
            title="Complex products get learned the slow way."
            quiet="One task can take three tools and three days."
          />
          <dl className="pb-stats">
            <div>
              <dt className="tag">The old way</dt>
              <dd className="pb-num">3 days</dd>
            </div>
            <span className="pb-arrow" aria-hidden="true">
              →
            </span>
            <div className="new">
              <dt className="tag">With Poko</dt>
              <dd className="pb-num">2 min</dd>
            </div>
          </dl>
        </div>

        <figure className="pb-chart">
          <div className="pb-axis tag" aria-hidden="true">
            <span>now</span>
            <span>1 hour</span>
            <span>day 1</span>
            <span>day 2</span>
            <span>day 3</span>
          </div>
          <div className="pb-stage">
            <svg className="pb-wander" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
              <path d="M12 14 C 40 14, 60 79, 136 79 C 300 79, 300 195, 441 195 C 590 195, 600 76, 745 76 C 880 76, 900 200, 988 200" />
            </svg>
            <article className="pb-card pb-course" style={at(0)}>
              <p className="pb-when tag">after 1 hour</p>
              <div className="pb-video">
                <span className="pb-thumb" aria-hidden="true">
                  <Icon name="play" size={14} />
                </span>
                <p>
                  <b>Admin training</b>
                  <span>Module 3 of 9</span>
                </p>
              </div>
              <div className="pb-progress">
                <span aria-hidden="true">
                  <i />
                </span>
                <span className="tag">47:12</span>
              </div>
            </article>
            <article className="pb-card pb-docs" style={at(1)}>
              <p className="pb-when tag">day 1</p>
              <p>
                <b>IAM policies</b>
                <span>Docs · page 14 of 40</span>
              </p>
              <span className="pb-text" aria-hidden="true" />
              <span className="pb-text" aria-hidden="true" />
              <span className="pb-text short" aria-hidden="true" />
            </article>
            <article className="pb-card pb-ticket" style={at(2)}>
              <p className="pb-when tag">day 2, still waiting</p>
              <p>
                <span className="tag">#48213</span>
                <b>Can’t give read-only access</b>
              </p>
              <span className="pb-status">Waiting on support</span>
              <span className="pb-reply">First reply in 2 days</span>
            </article>
            <p className="pb-end tag" aria-hidden="true">
              done, day 3
            </p>
          </div>
          <div className="pb-poko">
            <LogoMark size={24} />
            <span className="pb-line" aria-hidden="true" />
            <span className="pb-check" aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
            <p>
              <b>Done in 2 minutes,</b> inside the product.
            </p>
          </div>
          <figcaption className="tag">Illustrative: one task, one new user.</figcaption>
        </figure>
      </div>
    </section>
  );
}

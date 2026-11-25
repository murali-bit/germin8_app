import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  Code2,
  PencilRuler,
  Calculator,
  Puzzle,
  UserRoundCheck,
  MessagesSquare,
  BookOpen,
  ArrowRight,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import {
  PageIntro,
  Section,
  SectionTitle,
  FeatureCards,
  Photo,
  PHOTOS,
  Eyebrow,
  Accent,
} from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';

const PEOPLE: { icon: LucideIcon; title: string; body: string; points: string[] }[] = [
  {
    icon: Code2,
    title: 'Engineers',
    body: 'People who enjoy turning a messy manual process into software that gets it right every time.',
    points: ['Comfortable with data that does not arrive clean', 'Care about checks and edge cases', 'Happy to learn how accounting works'],
  },
  {
    icon: PencilRuler,
    title: 'Product designers',
    body: 'People who can make a long compliance task feel short, and make a review screen easy to trust.',
    points: ['Design for people who use a tool all day', 'Sit with users and watch them work', 'Prefer clear over clever'],
  },
  {
    icon: Calculator,
    title: 'Chartered accountants who like software',
    body: 'Qualified professionals who know the work inside out and want to shape the tools rather than do the same task by hand again.',
    points: ['Know the rules and where people trip up', 'Can explain a process step by step', 'Curious about how software is built'],
  },
];

export const CareersPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Careers · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Careers"
        eyebrowIcon={Briefcase}
        title="Work with us on"
        accent="finance software"
        description="We are a small team building tools that take over finance work, piece by piece. We don’t have open roles listed right now, but we always want to hear from people who would fit."
      />

      <Section>
        <SectionTitle
          eyebrow="Who we look for"
          title="Three kinds of people, one"
          accent="shared interest"
          description="Everyone here cares about the same thing: finance work done properly, by software, so people can spend their time on judgement."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 [perspective:1400px]">
          {PEOPLE.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08}>
              <TiltCard max={5} className="h-full">
                <div
                  className="h-full rounded-3xl bg-white ring-1 ring-ink-200 p-7 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_40px_70px_-36px_rgba(23,23,22,0.4)]"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <span
                    className="w-14 h-14 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center"
                    style={{ transform: 'translateZ(36px)' }}
                  >
                    <p.icon className="w-6 h-6" strokeWidth={1.6} aria-hidden />
                  </span>
                  <h3 className="mt-6 text-[21px] font-extrabold font-display tracking-[-0.02em] text-ink-950">{p.title}</h3>
                  <p className="mt-2 text-[15.5px] leading-relaxed text-ink-500">{p.body}</p>
                  <ul className="mt-5 space-y-2.5">
                    {p.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2.5 text-[14.5px] text-ink-700">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-mustard-500 shrink-0" aria-hidden />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="paper">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center mb-14">
          <Reveal className="lg:col-span-6">
            <Eyebrow icon={Puzzle}>How we work</Eyebrow>
            <h2 className="mt-5 text-[32px] sm:text-[44px] font-extrabold font-display tracking-[-0.03em] leading-[1.08] text-ink-950">
              Small pieces, finished <Accent>properly</Accent>
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-ink-500">
              We pick one piece of finance work, understand it the way an accountant does, and build software that
              does it well. Then we move to the next piece. Engineers, designers and accountants work on the same
              problem together from the first conversation.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="lg:col-span-6">
            <Photo
              src={PHOTOS.teamLaptops}
              alt="A small team working together on laptops"
              className="shadow-[0_40px_80px_-40px_rgba(23,23,22,0.45)]"
            />
          </Reveal>
        </div>
        <Reveal>
          <FeatureCards
            items={[
              {
                icon: UserRoundCheck,
                title: 'Close to the people who use it',
                body: 'We talk to the accountants and founders using our tools, and we watch how they work before we change anything.',
              },
              {
                icon: MessagesSquare,
                title: 'Plain talk',
                body: 'We write and speak simply, inside the team and with clients. If something is not ready, we say so.',
              },
              {
                icon: BookOpen,
                title: 'Learn the other side',
                body: 'Engineers learn how a trial balance works. Accountants learn how software is built. Both make the product better.',
              },
            ]}
          />
        </Reveal>
      </Section>

      <Section>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200 px-6 py-12 sm:px-14 sm:py-14">
            <div aria-hidden className="absolute left-0 top-0 h-full w-1.5 bg-mustard-500" />
            <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-8">
                <h2 className="text-3xl sm:text-4xl font-bold font-display tracking-tight text-ink-950">Send us a note</h2>
                <p className="mt-4 text-lg text-ink-500 max-w-2xl">
                  Tell us who you are, what you have worked on and which piece of finance work you would like to fix.
                  A link to your work helps more than a long CV.
                </p>
              </div>
              <div className="lg:col-span-4 flex lg:justify-end">
                <Link
                  to="/contact"
                  className="group inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 text-[15px] font-bold font-display shadow-[0_12px_26px_-12px_rgba(23,23,22,0.23)] transition-all hover:-translate-y-0.5"
                >
                  <Mail className="w-4 h-4" aria-hidden />
                  Get in touch
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </Section>
    </div>
  );
};

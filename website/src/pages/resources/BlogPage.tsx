import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Search, ArrowRight, Clock } from 'lucide-react';
import { PageIntro, Container, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';
import { BLOG_POSTS } from '@/data/blogData';
import { cn } from '@/lib/utils';

const CATEGORIES = ['All', ...Array.from(new Set(BLOG_POSTS.map((p) => p.category)))];

export const BlogPage: React.FC = () => {
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Blog · Germin8';
  }, []);

  const q = query.trim().toLowerCase();
  const posts = BLOG_POSTS.filter(
    (p) =>
      (category === 'All' || p.category === category) &&
      (!q || p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q))
  );
  const [featured, ...rest] = posts;

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Blog"
        eyebrowIcon={Newspaper}
        title="Notes from the"
        accent="work"
        description="What we learn while automating finance work: Tally to Zoho moves, ROC filings and the checks in between."
      />

      <Container className="pb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={cn(
                  'h-10 px-4 rounded-full text-[14px] font-semibold font-display transition-colors',
                  category === c ? 'bg-ink-950 text-white' : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:ring-ink-400'
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="relative w-full md:w-72">
            <span className="sr-only">Search posts</span>
            <Search className="w-4 h-4 text-ink-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-white ring-1 ring-ink-200 text-[15px] text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-mustard-400"
            />
          </label>
        </div>

        {posts.length === 0 ? (
          <div className="mt-10 rounded-2xl bg-paper ring-1 ring-ink-200 p-10 text-center">
            <p className="text-lg font-bold font-display text-ink-950">No posts match that.</p>
            <p className="mt-1 text-ink-500">Try another word or category.</p>
          </div>
        ) : (
          <>
            {featured && (
              <Reveal className="mt-10">
                <Link
                  to={`/blog/${featured.slug}`}
                  className="group block rounded-3xl bg-paper ring-1 ring-ink-200 p-7 sm:p-10 transition-all duration-300 hover:ring-ink-300 hover:-translate-y-1 hover:shadow-[0_32px_60px_-32px_rgba(23,23,22,0.35)]"
                >
                  <PostMeta category={featured.category} date={featured.publishedDate} readTime={featured.readTime} />
                  <h2 className="mt-4 max-w-3xl text-[26px] sm:text-[34px] font-extrabold font-display tracking-[-0.02em] leading-[1.15] text-ink-950">
                    {featured.title}
                  </h2>
                  <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-500">{featured.summary}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold font-display text-mustard-700 group-hover:text-ink-950">
                    Read the post
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </Reveal>
            )}

            {rest.length > 0 && (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {rest.map((p, i) => (
                  <Reveal key={p.slug} delay={i * 0.05}>
                    <Link
                      to={`/blog/${p.slug}`}
                      className="group flex h-full flex-col rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-all duration-300 hover:ring-ink-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]"
                    >
                      <PostMeta category={p.category} date={p.publishedDate} readTime={p.readTime} />
                      <h3 className="mt-4 text-[19px] font-bold font-display leading-snug text-ink-950">{p.title}</h3>
                      <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-500">{p.summary}</p>
                      <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold font-display text-mustard-700 group-hover:text-ink-950">
                        Read
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </Link>
                  </Reveal>
                ))}
              </div>
            )}
          </>
        )}
      </Container>

      <FinalCTA
        title="Have a finance task you repeat every month?"
        description="Tell us about it. It may be the next tool we build."
        primary={{ to: '/products/custom-automation', label: 'Custom automation' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};

const PostMeta: React.FC<{ category: string; date: string; readTime: string }> = ({ category, date, readTime }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-500">
    <span className="rounded-full bg-ink-50 ring-1 ring-ink-200 px-2.5 py-0.5 font-semibold text-ink-950">
      {category}
    </span>
    <span>{date}</span>
    <span className="inline-flex items-center gap-1">
      <Clock className="w-3.5 h-3.5" aria-hidden />
      {readTime}
    </span>
  </div>
);

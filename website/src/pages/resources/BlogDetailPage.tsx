import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Clock, Check, FileQuestion } from 'lucide-react';
import { Container, Btn, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';
import { BLOG_POSTS } from '@/data/blogData';

export const BlogDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  useEffect(() => {
    document.title = `${post ? post.title : 'Post not found'} · Germin8`;
  }, [post]);

  if (!post) {
    return (
      <div className="bg-white pt-32 lg:pt-40 pb-24">
        <Container>
          <div className="max-w-xl mx-auto text-center">
            <span className="mx-auto w-14 h-14 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
              <FileQuestion className="w-6 h-6" strokeWidth={1.75} aria-hidden />
            </span>
            <h1 className="mt-6 text-[32px] sm:text-[40px] font-extrabold font-display tracking-[-0.025em] text-ink-950">
              We couldn&rsquo;t find that post
            </h1>
            <p className="mt-3 text-lg text-ink-500">It may have been renamed or taken down. The rest of the blog is still here.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Btn to="/blog" arrow>
                Back to the blog
              </Btn>
              <Btn to="/resources" variant="secondary">
                All resources
              </Btn>
            </div>
          </div>
        </Container>
      </div>
    );
  }

  const related = [
    ...BLOG_POSTS.filter((p) => p.slug !== post.slug && p.category === post.category),
    ...BLOG_POSTS.filter((p) => p.slug !== post.slug && p.category !== post.category),
  ].slice(0, 2);

  return (
    <div className="bg-white">
      <header className="relative overflow-hidden pt-28 lg:pt-36 pb-10">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/80 to-white" />
        <Container className="relative">
          <div className="max-w-3xl mx-auto">
            <Link
              to="/blog"
              className="group inline-flex items-center gap-1.5 text-[14px] font-semibold font-display text-ink-600 hover:text-ink-950"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden />
              Blog
            </Link>
            <p className="mt-6">
              <span className="rounded-full bg-white ring-1 ring-ink-300 px-3 py-1 text-[13px] font-semibold font-display text-ink-950">
                {post.category}
              </span>
            </p>
            <h1 className="mt-5 text-[32px] sm:text-[44px] font-extrabold font-display tracking-[-0.03em] leading-[1.1] text-ink-950">
              {post.title}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-500">{post.summary}</p>
            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-ink-500">
              <span className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-full bg-ink-950 text-mustard-400 flex items-center justify-center text-[13px] font-bold font-display">
                  G8
                </span>
                <span>
                  <span className="block font-semibold text-ink-950">{post.author.name}</span>
                  <span className="block text-[13px]">{post.author.role}</span>
                </span>
              </span>
              <span aria-hidden className="hidden sm:block w-px h-8 bg-ink-200" />
              <span>{post.publishedDate}</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" aria-hidden />
                {post.readTime}
              </span>
            </div>
          </div>
        </Container>
      </header>

      <Container className="pb-8">
        <article className="max-w-3xl mx-auto">
          {post.keyTakeaways.length > 0 && (
            <div className="rounded-2xl bg-paper ring-1 ring-ink-200 p-6 sm:p-7">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-500 font-display">In short</h2>
              <ul className="mt-4 space-y-3">
                {post.keyTakeaways.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[15.5px] leading-relaxed text-ink-700">
                    <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-mustard-500 text-ink-950 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-10 space-y-6 text-[17.5px] leading-[1.75] text-ink-700">
            {post.content.map((paragraph, idx) => (
              <p key={idx}>{paragraph}</p>
            ))}
          </div>

          <div className="mt-12 pt-8 border-t border-ink-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <Link
              to="/blog"
              className="group inline-flex items-center gap-1.5 text-[15px] font-semibold font-display text-mustard-700 hover:text-ink-950"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden />
              All posts
            </Link>
            <Link
              to="/book-a-demo"
              className="group inline-flex items-center gap-1.5 text-[15px] font-semibold font-display text-ink-950 hover:text-mustard-700"
            >
              Talk to us about this
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </article>

        {related.length > 0 && (
          <section className="max-w-5xl mx-auto mt-20">
            <h2 className="text-[26px] font-extrabold font-display tracking-[-0.02em] text-ink-950">Related posts</h2>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-5">
              {related.map((p, i) => (
                <Reveal key={p.slug} delay={i * 0.05}>
                  <Link
                    to={`/blog/${p.slug}`}
                    className="group flex h-full flex-col rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-all duration-300 hover:ring-ink-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]"
                  >
                    <span className="text-[13px] font-semibold text-mustard-700">{p.category}</span>
                    <h3 className="mt-2 text-[18px] font-bold font-display leading-snug text-ink-950">{p.title}</h3>
                    <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-500">{p.summary}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold font-display text-mustard-700 group-hover:text-ink-950">
                      Read
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </section>
        )}
      </Container>

      <FinalCTA
        title="See the tools behind these posts"
        description="Every tool, what it does and the problem it solves."
        primary={{ to: '/resources/tools', label: 'Tools library' }}
        secondary={{ to: '/book-a-demo', label: 'Book a demo' }}
      />
    </div>
  );
};

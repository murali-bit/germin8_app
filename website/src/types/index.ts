export interface NavItem {
  label: string;
  href: string;
  description?: string;
  badge?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface BlogPost {
  slug: string;
  title: string;
  summary: string;
  category: 'Data Migration' | 'MCA Compliance' | 'Accounting Tech' | 'Best Practices';
  readTime: string;
  publishedDate: string;
  author: {
    name: string;
    role: string;
  };
  content: string[];
  keyTakeaways: string[];
}

export interface CaseStudy {
  slug: string;
  title: string;
  clientType: string;
  industry: string;
  challenge: string;
  solution: string;
  metrics: { label: string; value: string; description: string }[];
  summary: string;
  content: string[];
}

export interface DocArticle {
  id: string;
  title: string;
  category: string;
  description: string;
  lastUpdated: string;
  path: string;
}

import { memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';

/** Copy-to-clipboard button shown in the top-right of code blocks. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="md-copy-btn"
      title="Copy code"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * Custom component overrides so react-markdown elements blend with
 * the glass-desktop theme defined in index.css.
 */
const components: Components = {
  // ---------- code / pre ----------
  pre({ children, ...props }) {
    // Extract raw text for the copy button
    let raw = '';
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === 'object' && 'props' in child) {
      const codeProps = child.props as { children?: React.ReactNode };
      if (typeof codeProps.children === 'string') {
        raw = codeProps.children;
      } else if (Array.isArray(codeProps.children)) {
        raw = codeProps.children
          .map((c: unknown) => (typeof c === 'string' ? c : ''))
          .join('');
      }
    }

    return (
      <div className="md-code-block">
        <CopyButton text={raw} />
        <pre {...props}>{children}</pre>
      </div>
    );
  },

  code({ className, children, ...props }) {
    // If the className contains "language-*" it's a fenced block (rendered
    // inside <pre> above).  Otherwise it's inline code.
    const isInline = !className;
    if (isInline) {
      return (
        <code className="md-inline-code" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },

  // ---------- links ----------
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="md-link"
        {...props}
      >
        {children}
      </a>
    );
  },

  // ---------- tables ----------
  table({ children, ...props }) {
    return (
      <div className="md-table-wrap">
        <table {...props}>{children}</table>
      </div>
    );
  },

  // ---------- blockquote ----------
  blockquote({ children, ...props }) {
    return (
      <blockquote className="md-blockquote" {...props}>
        {children}
      </blockquote>
    );
  },
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

interface MarkdownRendererProps {
  content: string;
  /** When true (user messages) render as plain text — no markdown parsing. */
  plain?: boolean;
}

/**
 * Renders markdown, LaTeX (KaTeX), GFM tables, and syntax-highlighted code.
 * Memoised so streaming deltas don't re-parse unchanged messages.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  plain,
}: MarkdownRendererProps) {
  if (plain) {
    return <p className="whitespace-pre-wrap">{content}</p>;
  }

  return (
    <div className="md-root">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

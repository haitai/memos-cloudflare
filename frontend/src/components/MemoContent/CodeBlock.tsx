import copy from "copy-to-clipboard";
import { CopyIcon } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { cn } from "@/utils";
import { escapeHtml, getHighlighter } from "@/helpers/highlight";
import { BaseProps } from "./types";

// mermaid is ~147kB gzipped. It is only needed for ```mermaid code blocks, but a
// static import dragged it into every visitor's initial bundle.
const MermaidBlock = lazy(() => import("./MermaidBlock"));

// Special languages that are rendered differently.
enum SpecialLanguage {
  HTML = "__html",
  MERMAID = "mermaid",
}

interface Props extends BaseProps {
  language: string;
  content: string;
}

const CodeBlock: React.FC<Props> = ({ language, content }: Props) => {
  // All hooks run unconditionally, above the early returns. They used to sit
  // after the `special language` returns, which breaks React's hook ordering
  // rules the moment `language` changes into or out of a special value.
  const [highlightedCode, setHighlightedCode] = useState<string>();

  const formatedLanguage = useMemo(() => (language || "").toLowerCase() || "text", [language]);

  useEffect(() => {
    let cancelled = false;

    // highlight.js bundles ~190 grammars (~309kB gzipped). Importing it here
    // keeps all of that off the critical path; escaped plain text is rendered
    // until it arrives.
    getHighlighter().then((hljs) => {
      if (cancelled) return;

      try {
        if (hljs.getLanguage(formatedLanguage)) {
          setHighlightedCode(
            hljs.highlight(content, {
              language: formatedLanguage,
            }).value,
          );
          return;
        }
      } catch {
        // Unsupported language - fall through to escaped output.
      }

      setHighlightedCode(escapeHtml(content));
    });

    return () => {
      cancelled = true;
    };
  }, [formatedLanguage, content]);

  const handleCopyButtonClick = useCallback(() => {
    copy(content);
    toast.success("Copied to clipboard!");
  }, [content]);

  if (formatedLanguage === SpecialLanguage.HTML) {
    // Users can set Markdown code blocks as `__html` to render HTML directly.
    return (
      <div
        className="w-full overflow-auto my-2!"
        dangerouslySetInnerHTML={{
          __html: content,
        }}
      />
    );
  } else if (formatedLanguage === SpecialLanguage.MERMAID) {
    // Show the raw source while the mermaid chunk loads.
    return (
      <Suspense fallback={<pre className="w-full p-2 whitespace-pre-wrap relative">{content}</pre>}>
        <MermaidBlock content={content} />
      </Suspense>
    );
  }

  // Escape HTML entities while the highlighter is still loading.
  const html = highlightedCode ?? escapeHtml(content);

  return (
    <div className="w-full my-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      <div className="w-full px-3 py-2 flex flex-row justify-between items-center bg-gray-100 dark:bg-zinc-700 border-b border-gray-200 dark:border-zinc-600">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">
          {formatedLanguage || 'code'}
        </span>
        <CopyIcon
          className="w-4 h-4 cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          onClick={handleCopyButtonClick}
        />
      </div>

      <div className="overflow-auto max-h-96">
        <pre className="w-full p-4 bg-white dark:bg-zinc-900 m-0">
          <code
            className={cn(`language-${formatedLanguage}`, "block text-sm leading-relaxed font-mono whitespace-pre")}
            dangerouslySetInnerHTML={{ __html: html }}
          ></code>
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;

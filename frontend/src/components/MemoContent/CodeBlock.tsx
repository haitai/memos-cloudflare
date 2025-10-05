import copy from "copy-to-clipboard";
import hljs from "highlight.js";
import { CopyIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { cn } from "@/utils";
import MermaidBlock from "./MermaidBlock";
import { BaseProps } from "./types";

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
  const formatedLanguage = useMemo(() => (language || "").toLowerCase() || "text", [language]);

  // Users can set Markdown code blocks as `__html` to render HTML directly.
  if (formatedLanguage === SpecialLanguage.HTML) {
    return (
      <div
        className="w-full overflow-auto my-2!"
        dangerouslySetInnerHTML={{
          __html: content,
        }}
      />
    );
  } else if (formatedLanguage === SpecialLanguage.MERMAID) {
    return <MermaidBlock content={content} />;
  }

  const highlightedCode = useMemo(() => {
    try {
      const lang = hljs.getLanguage(formatedLanguage);
      if (lang) {
        return hljs.highlight(content, {
          language: formatedLanguage,
        }).value;
      }
    } catch {
      // Skip error and use default highlighted code.
    }

    // Escape any HTML entities when rendering original content.
    return Object.assign(document.createElement("span"), {
      textContent: content,
    }).innerHTML;
  }, [formatedLanguage, content]);

  const handleCopyButtonClick = useCallback(() => {
    copy(content);
    toast.success("Copied to clipboard!");
  }, [content]);

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
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          ></code>
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;

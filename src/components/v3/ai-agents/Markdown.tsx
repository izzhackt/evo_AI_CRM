import type { ReactNode } from "react";

import { parseMarkdown, type MdBlock, type MdInline } from "@/lib/v3/ai-agents-view";

/**
 * Безопасный Markdown отчётов агента: разбор в `ai-agents-view.ts` отдаёт
 * только известные блоки, ссылки только `http(s)`, любой HTML остаётся
 * текстом. Строка в HTML не превращается нигде: отчёт пишет модель, поэтому
 * его разметке не верят.
 */
function Inline({ nodes }: Readonly<{ nodes: readonly MdInline[] }>): ReactNode {
  return nodes.map((node, index) => {
    switch (node.t) {
      case "text": return node.text;
      case "strong": return <strong key={index} className="font-semibold text-fg"><Inline nodes={node.children} /></strong>;
      case "em": return <em key={index}><Inline nodes={node.children} /></em>;
      case "code": return <code key={index} className="rounded-[4px] bg-surface-2 px-1 font-mono text-[0.9em] text-fg">{node.text}</code>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="text-fg underline underline-offset-4">
            <Inline nodes={node.children} />
          </a>
        );
    }
  });
}

function Block({ block }: Readonly<{ block: MdBlock }>): ReactNode {
  switch (block.t) {
    case "heading":
      return block.level === 2
        ? <h3 className="t-section mt-5 max-w-[72ch] text-fg first:mt-0"><Inline nodes={block.children} /></h3>
        : <h4 className="t-item mt-4 max-w-[72ch] text-fg first:mt-0"><Inline nodes={block.children} /></h4>;
    case "paragraph":
      return <p className="t-body mt-2 max-w-[72ch] text-fg-2 first:mt-0"><Inline nodes={block.children} /></p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`mt-2 max-w-[72ch] space-y-1 ps-5 t-body text-fg-2 first:mt-0 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-fg-3`}>
          {block.items.map((item, index) => <li key={index}><Inline nodes={item} /></li>)}
        </Tag>
      );
    }
    case "quote":
      return <blockquote className="mt-2 max-w-[72ch] rounded-card bg-surface-2 px-3 py-2 t-body-compact text-fg-2 first:mt-0"><Inline nodes={block.children} /></blockquote>;
    case "code":
      return <pre className="mt-2 overflow-x-auto rounded-card bg-surface-2 p-3 font-mono text-[13px] leading-5 text-fg first:mt-0">{block.text}</pre>;
    case "rule":
      return <hr className="my-4 border-border" />;
    case "table":
      return (
        // Таблица занимает всю ширину листа (не «72ch» текста), длинные ячейки переносятся по словам; на телефоне — прокрутка вбок, слова целые.
        <div className="mt-2 overflow-x-auto rounded-card border border-border first:mt-0">
          <table className="w-full min-w-[32rem] t-body-compact">
            <thead>
              <tr className="border-b border-border bg-surface-2/60">
                {block.head.map((cell, index) => <th key={index} scope="col" className="px-3 py-2 text-start font-medium text-fg"><Inline nodes={cell} /></th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border last:border-b-0">
                  {row.map((cell, index) => <td key={index} className="px-3 py-1.5 align-top tabular-nums text-fg-2 break-words"><Inline nodes={cell} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ source }: Readonly<{ source: string }>) {
  const blocks = parseMarkdown(source);
  return (
    <div data-testid="v3-aia-markdown">
      {blocks.map((block, index) => <Block key={index} block={block} />)}
    </div>
  );
}

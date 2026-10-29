import type { CaseFile } from '../../strategies/types';
import { createFreeTextDetector } from '../../detect/freetext';
function Highlight({ text }: { text: string }) {
  const spans = createFreeTextDetector().detect(text), parts = []; let cursor=0;
  for (const [i,s] of spans.entries()) { parts.push(<span key={`t${i}`}>{text.slice(cursor,s.start)}</span>,<mark title={`Heuristic: ${s.kind}`} key={`m${i}`}>{text.slice(s.start,s.end)}</mark>);cursor=s.end; }
  parts.push(<span key="last">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}
export function ConfigDiff({ original, output }: { original: CaseFile; output: CaseFile | null }) {
  return <section className="file-diff"><h3>{original.fileId} <small>{original.name}</small></h3><div className="diff-grid"><div><p>Original · public-pattern highlights</p><pre><Highlight text={original.text}/></pre></div><div><p>Output {output?`· ${output.name}`:'· not run'}</p><pre>{output?<Highlight text={output.text}/>:<span className="muted">Run a transformation to inspect output.</span>}</pre></div></div></section>;
}

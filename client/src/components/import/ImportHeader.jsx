import { T } from "../shared";

export function ImportHeader({ onClose }) {
  return (
<>
{/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Donors</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>One file: your donors and their giving history. We sort out the columns and stages for you.</div>
            {/* LOST & FOUND — somebody who ran the free audit and then signed
                up still has the file open on their desk, and the obvious
                next thing is to import the same one. The FILE did not
                travel: it never left their browser, and carrying it here in
                storage would break the promise the audit page makes. What
                travelled is the intent, so this is a sentence, not a
                pre-filled upload. */}
            {(() => {
              let from = null;
              try { from = JSON.parse(sessionStorage.getItem("steward_from_audit") || "null"); } catch { from = null; }
              if (!from) return null;
              return (
                <div data-testid="import-from-audit"
                  style={{fontSize:12.5,color:T.ink2,background:T.green100,border:"1px solid "+T.green200,
                          borderRadius:9,padding:"8px 11px",marginTop:8,lineHeight:1.5,maxWidth:520}}>
                  You ran a Lost &amp; Found audit{from.fileName ? ` on ${from.fileName}` : ""}. Use the same file here and
                  Steward keeps the whole history, not just the names.
                </div>
              );
            })()}
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>
</>
  );
}

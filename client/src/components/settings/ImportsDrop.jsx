import { useState } from "react";
import SpreadsheetImport, { SheetDropTarget } from "../SpreadsheetImport";

// FIX-55: a spreadsheet dropped anywhere on Imports opens the one reader with it.
export function ImportsDrop({isReadOnly,children}){
  const [file,setFile]=useState(null);
  return (
    <SheetDropTarget disabled={isReadOnly} onFile={setFile} style={{display:"flex",flexDirection:"column",gap:16}}>
      {children}
      {file&&<SpreadsheetImport key={file.name+file.lastModified} file={file} onClose={()=>setFile(null)} onImported={()=>setFile(null)}/>}
    </SheetDropTarget>
  );
}

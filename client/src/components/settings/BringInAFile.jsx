import { T } from "../shared";

// POLISH-2 Part 6: the Imports tab leads with the one thing it is for. The
// button opens the same import wizard as Donors, "↑ Import & tools".
export function BringInAFile({onNavigate,isReadOnly}){
  return (
    <div data-testid="imports-lead" style={{background:T.bgCard,border:"1px solid "+T.bg3,borderRadius:16,padding:"20px 28px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
      <div style={{flex:"1 1 280px",fontSize:13,color:T.ink3,lineHeight:1.6}}>
        A spreadsheet of donors, a gift export, or your old system's file. Steward shows you what it read before anything is saved.
      </div>
      <button data-testid="imports-bring-file" disabled={isReadOnly||!onNavigate}
        onClick={()=>onNavigate&&onNavigate("donors",{openImport:true})}
        style={{background:T.green,border:"none",borderRadius:8,padding:"10px 18px",color:T.white,fontSize:13,fontWeight:700,
                cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>
        Bring in a file
      </button>
    </div>
  );
}

import { T, PersonMark, interactive } from "../shared";
import { displayName } from "../../../../shared/displayName.js";
import { DonorLink } from "../RecordLink";

export function MiniEmpty({ cPad, sLink }) {
  const MiniEmpty=({icon,text,cta,onCta})=>(
    <div style={{...cPad,display:"flex",alignItems:"center",gap:12}}>
      <div style={{fontSize:20,opacity:0.3,color:T.greenDk,flexShrink:0,lineHeight:1}}>{icon}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,color:T.ink3,lineHeight:1.5}}>{text}</div>
        {cta&&<button onClick={onCta} style={{...sLink,marginTop:3,fontSize:12}}>{cta}</button>}
      </div>
    </div>
  );
  return MiniEmpty;
}

export function Sparkline() {
  const Sparkline=({trend,color,width=100,height=30})=>{
    if(!trend||trend.length<2)return null;
    const vals=trend.map(t=>t.value);
    const min=Math.min(...vals),max=Math.max(...vals);
    const range=max-min||1;
    const pts=trend.map((t,i)=>{
      const x=(i/(trend.length-1))*width;
      const y=height-((t.value-min)/range)*height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  };
  return Sparkline;
}

export function DonorChip() {
  const DonorChip=({id,name,detail,onClick})=>{
    const chipStyle={display:"flex",alignItems:"center",gap:6,background:T.bg,border:"1px solid "+T.bg3,borderRadius:99,padding:"3px 10px 3px 3px",cursor:"pointer",fontSize:11,maxWidth:180};
    const inner=<>
      <PersonMark id={id} name={name} size={20}/>
      <span style={{fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayName(name)}</span>
      {detail&&<span style={{color:T.ink3,whiteSpace:"nowrap",flexShrink:0}}>{detail}</span>}
    </>;
    return id?<DonorLink id={id} onOpen={onClick} style={chipStyle}>{inner}</DonorLink>:<button onClick={onClick} style={chipStyle}>{inner}</button>;
  };
  return DonorChip;
}

export function MoreChip() {
  const MoreChip=({count,onClick})=>(
    <button onClick={onClick} style={{background:"transparent",border:"1px dashed "+T.bg3,borderRadius:99,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:T.greenDk,whiteSpace:"nowrap"}}>
      +{count} more →
    </button>
  );
  return MoreChip;
}

export function GoalStat() {
  const GoalStat=({label,value,valueColor,sub,onClick})=>(
    <div {...interactive(onClick,{label:onClick?`Open ${label}`:undefined})}
      style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"8px 12px"}}>
      <div style={{fontSize:9,fontWeight:800,color:T.ink3,marginBottom:3}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:valueColor||T.inkInverse,lineHeight:1.25}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:T.ink3,marginTop:2}}>{sub}</div>}
    </div>
  );
  return GoalStat;
}

export function StatIcon({ STAT_PATHS }) {
  const StatIcon=({name,color})=>(
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{STAT_PATHS[name]}</svg>
  );
  return StatIcon;
}

export function foldBtn({ homeFold, toggleFold }) {
  const foldBtn=(k,label)=>(
    <button type="button" data-testid={"fold-"+k} aria-expanded={!homeFold[k]} aria-label={(homeFold[k]?"Show ":"Hide ")+label} onClick={()=>toggleFold(k)}
      style={{background:"none",border:"1px solid "+T.bg3,borderRadius:999,width:24,height:24,display:"inline-flex",alignItems:"center",justifyContent:"center",
        cursor:"pointer",color:T.ink3,padding:0,flexShrink:0,transition:"transform .15s ease",transform:homeFold[k]?"rotate(-90deg)":"none"}}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
  );
  return foldBtn;
}

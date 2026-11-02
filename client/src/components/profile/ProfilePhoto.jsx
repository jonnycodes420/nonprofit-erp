// components/profile/ProfilePhoto.jsx (PROFILE-3): the face on the profile and its
// crop dialog, moved verbatim from DonorProfile.jsx.
import { useContext, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/domainError";
import { Modal, PersonMark, PhotoContext, T } from "../shared";
import { apiFetch } from "../../api";

// ── Donor Profile ──────────────────────────────────────────────────────────
// ── BUILD-95 — ADJUST IT BEFORE IT SETS ────────────────────────────────────
// The first version took whatever the file was and let the server centre-crop
// it. That is fine for a logo and wrong for a face: a phone photo is portrait,
// the head is rarely in the middle, and "upload and hope" is not how anybody
// has set a profile picture since about 2010.
//
// So: drag to move, pinch or scroll or drag the slider to zoom, and the circle
// is exactly what will be saved. The crop happens HERE, to a 512 square canvas,
// so what she positioned is byte-for-byte what the server stores — the server
// still cover-resizes, but on an already-square image that is a no-op rather
// than a second opinion about where the face is.
const PHOTO_CROP_PX = 512;
function PhotoAdjuster({ file, onCancel, onSet }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const drag = useRef(null);
  const BOX = 300;                       // the circle's diameter on screen

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      // Start at the smallest zoom that still FILLS the circle — never a gap.
      setImg(i); setZoom(1); setOff({ x: 0, y: 0 });
    };
    i.onerror = () => setErr("That file could not be opened as an image.");
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The scale at which the image exactly covers the circle. Everything else is
  // a multiple of this, so zoom=1 can never show background through the mask.
  const cover = img ? Math.max(BOX / img.width, BOX / img.height) : 1;
  const scale = cover * zoom;
  const dispW = img ? img.width * scale : 0;
  const dispH = img ? img.height * scale : 0;

  // Never let the image be dragged off the circle.
  const clamp = (o, s = scale) => {
    if (!img) return o;
    const maxX = Math.max(0, (img.width * s - BOX) / 2);
    const maxY = Math.max(0, (img.height * s - BOX) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) };
  };
  useEffect(() => { setOff(o => clamp(o)); }, [zoom, img]);

  const onDown = e => {
    const p = e.touches ? e.touches[0] : e;
    drag.current = { x: p.clientX, y: p.clientY, ox: off.x, oy: off.y };
  };
  const onMove = e => {
    if (!drag.current) return;
    if (e.cancelable) e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    setOff(clamp({ x: drag.current.ox + (p.clientX - drag.current.x), y: drag.current.oy + (p.clientY - drag.current.y) }));
  };
  const onUp = () => { drag.current = null; };
  useEffect(() => {
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false }); window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp);
    };
  });

  const set = async () => {
    if (!img) return;
    setBusy(true); setErr("");
    try {
      // The SAME transform, at output resolution. The circle on screen is a
      // BOX-wide window onto the scaled image; the canvas is the same window
      // at PHOTO_CROP_PX, so the ratio is the only thing that changes.
      const k = PHOTO_CROP_PX / BOX;
      const c = document.createElement("canvas");
      c.width = PHOTO_CROP_PX; c.height = PHOTO_CROP_PX;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img,
        (PHOTO_CROP_PX / 2) + (off.x - dispW / 2) * k,
        (PHOTO_CROP_PX / 2) + (off.y - dispH / 2) * k,
        dispW * k, dispH * k);
      // JPEG, not PNG: a photo as PNG is several megabytes for no benefit, and
      // the server re-encodes to WebP anyway.
      await onSet(c.toDataURL("image/jpeg", 0.92));
    } catch (e) { setErr(errorMessage(e, "Could not save that photo")); }
    setBusy(false);
  };

  return (
    <Modal onClose={busy ? () => {} : onCancel} title="Position the photo" width={380}>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55, marginBottom: 14 }}>
        Drag to move it. Scroll or use the slider to zoom. What you see in the circle is what is saved.
      </div>
      <div
        onMouseDown={onDown} onTouchStart={onDown}
        onWheel={e => { setZoom(z => Math.max(1, Math.min(4, z - e.deltaY * 0.0015))); }}
        style={{
          width: BOX, height: BOX, margin: "0 auto", borderRadius: "50%", overflow: "hidden",
          position: "relative", background: T.bg2, cursor: drag.current ? "grabbing" : "grab",
          touchAction: "none", border: `2px solid ${T.bg3}`,
        }}>
        {img && (
          <img src={img.src} alt="" draggable={false} data-testid="photo-adjust-image"
            style={{
              position: "absolute", left: "50%", top: "50%", width: dispW, height: dispH,
              transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))`,
              maxWidth: "none", userSelect: "none", pointerEvents: "none",
            }} />
        )}
      </div>
      <input type="range" min="1" max="4" step="0.01" value={zoom} aria-label="Zoom"
        data-testid="photo-adjust-zoom"
        onChange={e => setZoom(Number(e.target.value))}
        style={{ width: BOX, display: "block", margin: "16px auto 4px", accentColor: T.greenDk }} />
      {err && <div role="alert" style={{ fontSize: 12, color: T.gold700, textAlign: "center", marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
        <button onClick={set} disabled={busy || !img} data-testid="photo-adjust-set"
          style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "11px 26px",
                   color: T.white, fontSize: 14, fontWeight: 800, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : "Set photo"}
        </button>
        <button onClick={onCancel} disabled={busy}
          style={{ background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "11px 18px",
                   color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── BUILD-94 Part 1 — the photo control on the profile header ──────────────
// Drop an image on the mark or click it to pick one. 10 MB, any common raster
// format; the server checks the bytes are what the file says they are, crops
// to a 512 square WebP and throws the original away. "Remove" appears on hover
// (and on focus, so it is reachable without a mouse) once there is a photo.
function DonorPhotoControl({donor,isReadOnly,photoUrl,onChanged,size=46}){
  const fileRef=useRef(null);
  const photoCtx=useContext(PhotoContext);
  const [busy,setBusy]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const [err,setErr]=useState("");
  const [hover,setHover]=useState(false);

  // BUILD-95 — a picked or dropped file opens the ADJUSTER rather than
  // uploading. Nothing reaches the server until she has said where the face
  // is. The size and type rules are still the SERVER's — the browser is not
  // where either is enforced, it is only where the framing is chosen.
  const [pending,setPending]=useState(null);
  const pick=(file)=>{
    setErr("");
    if(!file)return;
    if(!/^image\//.test(file.type||"")){setErr("That file isn't an image.");return;}
    setPending(file);
  };
  const send=async(dataUri)=>{
    setBusy(true);setErr("");
    try{
      const r=await apiFetch(`/donors/${donor.id}/photo`,{method:"POST",body:JSON.stringify({image:dataUri})});
      onChanged(r&&r.photoUrl||null);
      photoCtx.refresh&&photoCtx.refresh();
      setPending(null);
    }catch(e){setErr(errorMessage(e,"Could not save that photo"));throw e;}
    finally{setBusy(false);}
  };
  const remove=async()=>{
    setBusy(true);setErr("");
    try{
      await apiFetch(`/donors/${donor.id}/photo`,{method:"DELETE"});
      onChanged(null);
      photoCtx.refresh&&photoCtx.refresh();
    }catch(e){setErr(errorMessage(e,"Could not remove that photo"));}
    setBusy(false);
  };

  const label=photoUrl?`Change ${donor.name}'s photo`:`Add a photo for ${donor.name}`;
  return (
    <div style={{position:"relative",flexShrink:0}}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      <button type="button" data-testid="donor-photo-drop" aria-label={label} title={isReadOnly?donor.name:label}
        disabled={isReadOnly||busy}
        onClick={()=>!isReadOnly&&fileRef.current&&fileRef.current.click()}
        onDragOver={e=>{if(isReadOnly)return;e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{if(isReadOnly)return;e.preventDefault();setDragOver(false);pick(e.dataTransfer.files&&e.dataTransfer.files[0]);}}
        style={{padding:0,border:dragOver?`2px dashed ${T.gold500}`:"2px solid transparent",borderRadius:"50%",
          background:"none",cursor:isReadOnly?"default":"pointer",lineHeight:0,opacity:busy?0.6:1,display:"block"}}>
        <PersonMark id={donor.id} name={donor.name} kind={donor.kind} url={photoUrl} size={size}/>
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{display:"none"}}
        onChange={e=>{pick(e.target.files&&e.target.files[0]);e.target.value="";}}/>
      {pending&&<PhotoAdjuster file={pending} onCancel={()=>setPending(null)} onSet={send}/>}
      {photoUrl&&!isReadOnly&&(hover||busy)&&(
        <button type="button" onClick={remove} disabled={busy} data-testid="donor-photo-remove"
          aria-label={`Remove ${donor.name}'s photo`} title="Remove photo"
          style={{position:"absolute",top:-3,right:-3,width:18,height:18,borderRadius:"50%",border:`1px solid ${T.bg3}`,
            background:T.white,color:T.ink3,fontSize:11,lineHeight:"16px",padding:0,cursor:"pointer"}}>&times;</button>
      )}
      {err&&<div role="alert" style={{position:"absolute",top:40,left:0,whiteSpace:"nowrap",zIndex:5,fontSize:11,
        color:T.gold700,background:T.gold100,border:`1px solid ${T.gold300}`,borderRadius:6,padding:"3px 7px"}}>{err}</div>}
    </div>
  );
}

export { PHOTO_CROP_PX, PhotoAdjuster, DonorPhotoControl };

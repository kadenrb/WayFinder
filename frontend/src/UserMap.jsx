/*
  ===============================================
  USER MAP VIEWER (Public Landing Page Experience)
  ===============================================
  Read‑only, multi‑floor wayfinding viewer used by end‑users.
  Key capabilities:
  - Load published floors (images + points + walkable settings)
  - Let the user set their current location ("I'm here")
  - Search for a room (supports aliases/ranges)
  - Draw a route on the current floor using the walkable color mask
  - Auto‑warp between floors via stairs/elevator POIs with the same Warp Key
  - Keyboard movement with arrow keys (snaps to walkable color)

  Important: This viewer reads from localStorage (wf_public_floors). In a SaaS
  deployment, this would fetch floors.json from a hosted location on the client’s
  website.
*/
import React, { useEffect, useMemo, useRef, useState } from 'react';

function markerClass(kind) {
  switch (kind) {
    case 'door': return 'bg-secondary';
    case 'poi': return 'bg-success';
    case 'room':
    default: return 'bg-primary';
  }
}

export default function UserMap() {
  const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
  const MANIFEST_URL = process.env.REACT_APP_MANIFEST_URL || "";
  const [floors, setFloors] = useState([]); // [{id,name,url,points,walkable}]
  const [selUrl, setSelUrl] = useState('');
  const [userPos, setUserPos] = useState(null); // {x,y}
  const [placing, setPlacing] = useState(false);
  const [dest, setDest] = useState(null); // { url, id }
  const [routePts, setRoutePts] = useState([]);
  const [autoWarp, setAutoWarp] = useState(true);
  const [gapCells, setGapCells] = useState(1);
  const [warpProximity, setWarpProximity] = useState(0.02); // normalized distance
  const [plan, setPlan] = useState(null); // { steps:[{ url, kind:'warp'|'dest', key?, target:{x,y} }], index }
  const dragRef = useRef(null);
  const [moveStep, setMoveStep] = useState(0.01); // normalized delta per arrow key press
  const [searchText, setSearchText] = useState("");
  const [searchMsg, setSearchMsg] = useState("");
  const [sensorTracking, setSensorTracking] = useState(false);
  const [sensorMsg, setSensorMsg] = useState("");
  const gridRef = useRef(null); // cached walkable grid for current floor
  const scrollRef = useRef(null);
  const spacerRef = useRef(null);
  const contentRef = useRef(null);
  const imgRef = useRef(null);
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });
  const initialFloorSetRef = useRef(false);
  const headingRef = useRef(0);
  const userPosRef = useRef(null);
  const lastMotionTsRef = useRef(null);
  const calibrationRef = useRef({ baseline: 0, samples: 0, done: false });
  const stepStateRef = useRef({ lastStepTs: 0, active: false });
  const STEP_DISTANCE = 0.012;

  // Load published floors from manifest (preferred) or API with localStorage fallback
  useEffect(() => {
    let aborted = false;
    const normalizeFloors = (arr = []) => {
      const toNumber = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      return arr
        .map((f, index) => ({
          ...f,
          url: f.url || f.imageData || '',
          points: Array.isArray(f.points) ? f.points : [],
          walkable: f.walkable || { color: '#9F9383', tolerance: 12 },
          sortOrder: typeof f.sortOrder === 'number' ? f.sortOrder : index,
          northOffset: toNumber(f.northOffset),
        }))
        .filter((f) => f.url);
    };

    const setInitialFloor = (list) => {
      if (!initialFloorSetRef.current && list.length) {
        setSelUrl((prev) => prev || list[0].url);
        initialFloorSetRef.current = true;
      }
    };

    const persistLocal = (list) => {
      try {
        localStorage.setItem('wf_public_floors', JSON.stringify({ floors: list }));
      } catch {
        /* ignore quota errors */
      }
    };

    const loadFromManifest = async () => {
      if (!MANIFEST_URL) return null;
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch manifest');
      const data = await res.json();
      return normalizeFloors(data?.floors);
    };

    const loadFromApi = async () => {
      const res = await fetch(`${API_URL}/floors`);
      if (!res.ok) throw new Error('Failed to fetch floors');
      const data = await res.json();
      return normalizeFloors(data?.floors);
    };

    const load = async () => {
      try {
        const manifestFloors = await loadFromManifest();
        if (!aborted && manifestFloors && manifestFloors.length) {
          setFloors(manifestFloors);
          setInitialFloor(manifestFloors);
          persistLocal(manifestFloors);
          return;
        }
      } catch (err) {
        console.error('Failed to load published floors from manifest', err);
      }
      try {
        const apiFloors = await loadFromApi();
        if (!aborted && apiFloors.length) {
          setFloors(apiFloors);
          setInitialFloor(apiFloors);
          persistLocal(apiFloors);
          return;
        }
      } catch (err) {
        console.error('Failed to load published floors from API', err);
      }
      if (aborted) return;
      try {
        const raw = localStorage.getItem('wf_public_floors');
        if (!raw) return;
        const data = JSON.parse(raw);
        const normalized = normalizeFloors(data?.floors);
        setFloors(normalized);
        setInitialFloor(normalized);
      } catch (e) {
        console.error('Failed to load local published floors', e);
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, [API_URL, MANIFEST_URL]);

  // Load per-floor user position
  useEffect(() => {
    try {
      if (!selUrl) { setUserPos(null); return; }
      const raw = localStorage.getItem(`wf_user_pos:${selUrl}`);
      if (!raw) { setUserPos(null); return; }
      const p = JSON.parse(raw);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') setUserPos({ x: p.x, y: p.y }); else setUserPos(null);
    } catch { setUserPos(null); }
  }, [selUrl]);
  useEffect(() => { userPosRef.current = userPos; if (!userPos && sensorTracking) { setSensorTracking(false); setSensorMsg("Tap 'I'm here' before enabling sensors."); } }, [userPos, sensorTracking]);

  const floor = useMemo(() => floors.find(f => f.url === selUrl) || null, [floors, selUrl]);

  const toNorm = (clientX, clientY) => {
    const el = spacerRef.current;
    const rect = el?.getBoundingClientRect();
    if (!rect || !natSize.w || !natSize.h) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const x = Math.min(1, Math.max(0, sx / (natSize.w)));
    const y = Math.min(1, Math.max(0, sy / (natSize.h)));
    return { x, y };
  };
  const toPx = (x, y) => ({ x: x * natSize.w, y: y * natSize.h });
  const onImgLoad = (e) => {
    setNatSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
    // Build/capture walkable grid for this floor
    const f = floors.find(fl => fl.url === selUrl);
    if (f) {
      Promise.resolve(buildGrid(e.target, f.walkable?.color, f.walkable?.tolerance, 4))
        .then(g => { gridRef.current = g; })
        .catch(() => { gridRef.current = null; });
    }
  };

  const saveUserPos = (url, p) => {
    try { localStorage.setItem(`wf_user_pos:${url || ''}`, JSON.stringify(p)); } catch {}
  };

  // Snap a normalized position to nearest walkable cell center (using cached grid)
  const snapToWalkable = (nx, ny) => {
    const g = gridRef.current; const img = imgRef.current; const f = floors.find(fl=>fl.url===selUrl);
    if (!g || !img || !f) return { x: nx, y: ny };
    const { grid, gw, gh, step, w, h } = g;
    const cx = Math.max(0, Math.min(gw-1, Math.round((nx * w) / step)));
    const cy = Math.max(0, Math.min(gh-1, Math.round((ny * h) / step)));
    const near = nearestWalkable(grid, gw, gh, cx, cy);
    if (!near) return { x: nx, y: ny };
    return { x: ((near[0]*step)+(step/2))/w, y: ((near[1]*step)+(step/2))/h };
  };

  // -------- Room search helpers (roomNumber and aliases/ranges) --------
  const normCode = (s) => (s||"").toString().toUpperCase().replace(/[\u2013\u2014]/g,'-').replace(/\s+/g,'').trim();
  const parseCode = (s) => {
    const m = /^([A-Z]*)(\d+)$/.exec(s);
    if (!m) return null; return { prefix: m[1]||'', num: parseInt(m[2],10) };
  };
  const parseRange = (s) => {
    const parts = s.split('-'); if (parts.length!==2) return null;
    const a = parseCode(parts[0]); const b = parseCode(parts[1]);
    if (!a || !b || a.prefix!==b.prefix) return null;
    const start = Math.min(a.num,b.num), end=Math.max(a.num,b.num);
    return { prefix:a.prefix, start, end };
  };
  const matchesPointCode = (p, code) => {
    if (!code) return false; const c = normCode(code);
    const rn = normCode(p.roomNumber||''); if (rn && rn===c) return true;
    const aliases = Array.isArray(p.aliases)? p.aliases : [];
    for (const a of aliases) {
      const an = normCode(a);
      if (!an) continue;
      if (an.includes('-')) { const r = parseRange(an); const pc = parseCode(c); if (r && pc && r.prefix===pc.prefix && pc.num>=r.start && pc.num<=r.end) return true; }
      else { if (an===c) return true; }
    }
    return false;
  };
  const searchRoom = () => {
    const q = normCode(searchText);
    if (!q) { setSearchMsg(''); return; }
    for (const f of floors) {
      const pts = Array.isArray(f.points)? f.points : [];
      const hit = pts.find(p=> matchesPointCode(p, q));
      if (hit) { setDest({ url: f.url, id: hit.id }); setSelUrl(f.url); setSearchMsg(`Destination set: ${hit.roomNumber||hit.name||hit.poiType||hit.kind}`); return; }
    }
    setSearchMsg('No matching room found');
  };

  const requestMotionPermissions = async () => {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') throw new Error('Motion permission denied');
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') throw new Error('Orientation permission denied');
    }
  };

  const startSensorTracking = async () => {
    if (!userPos) { setSensorMsg("Place yourself on the map first."); return; }
    if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') {
      setSensorMsg("Device motion API not supported.");
      return;
    }
    try {
      await requestMotionPermissions();
      calibrationRef.current = { baseline: 0, samples: 0, done: false };
      stepStateRef.current = { lastStepTs: performance.now ? performance.now() : Date.now(), active: false };
      setSensorTracking(true);
      setSensorMsg("Calibrating sensors. Hold still...");
    } catch (err) {
      setSensorMsg(err?.message || "Sensor permission denied.");
      setSensorTracking(false);
    }
  };

  const stopSensorTracking = () => {
    setSensorTracking(false);
    setSensorMsg("Tracking paused.");
    calibrationRef.current = { baseline: 0, samples: 0, done: false };
    stepStateRef.current = { lastStepTs: 0, active: false };
  };

  // Arrow key movement to spoof walking on desktop
  useEffect(() => {
    const onKey = (e) => {
      if (!userPos) return; // require an existing position
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -moveStep;
      else if (e.key === 'ArrowRight') dx = moveStep;
      else if (e.key === 'ArrowUp') dy = -moveStep;
      else if (e.key === 'ArrowDown') dy = moveStep;
      else return;
      e.preventDefault();
      const nx = Math.min(1, Math.max(0, userPos.x + dx));
      const ny = Math.min(1, Math.max(0, userPos.y + dy));
      const p = snapToWalkable(nx, ny);
      setUserPos(p);
      saveUserPos(selUrl, p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [userPos, moveStep, selUrl]);

  useEffect(() => {
    if (!sensorTracking) return;
    if (!userPosRef.current) {
      setSensorTracking(false);
      setSensorMsg("Place yourself on the map first.");
      return;
    }
    const northOffset = typeof floor?.northOffset === 'number' && Number.isFinite(floor.northOffset)
      ? floor.northOffset
      : 0;

    const normalizeHeading = (value) => {
      let heading = value;
      if (Number.isNaN(heading)) heading = 0;
      heading = heading - northOffset;
      heading %= 360;
      if (heading < 0) heading += 360;
      return heading;
    };

    const applyStep = () => {
      const pos = userPosRef.current;
      if (!pos) return;
      const heading = normalizeHeading(headingRef.current || 0);
      const rad = (heading * Math.PI) / 180;
      const dx = Math.sin(rad) * STEP_DISTANCE;
      const dy = -Math.cos(rad) * STEP_DISTANCE;
      const nx = Math.min(1, Math.max(0, pos.x + dx));
      const ny = Math.min(1, Math.max(0, pos.y + dy));
      const snapped = snapToWalkable(nx, ny);
      if (snapped.x !== pos.x || snapped.y !== pos.y) {
        setUserPos(snapped);
        saveUserPos(selUrl, snapped);
      }
    };

    const updateHeading = (event) => {
      if (typeof event.webkitCompassHeading === 'number') {
        headingRef.current = event.webkitCompassHeading;
      } else if (typeof event.alpha === 'number') {
        headingRef.current = 360 - event.alpha;
      }
    };

    const handleMotion = (event) => {
      const pos = userPosRef.current;
      if (!pos) return;
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;
      const magnitude = Math.sqrt(
        Math.pow(acc.x || 0, 2) +
        Math.pow(acc.y || 0, 2) +
        Math.pow(acc.z || 0, 2)
      );
      const calibrator = calibrationRef.current;
      if (!calibrator.done) {
        calibrator.baseline += magnitude;
        calibrator.samples += 1;
        if (calibrator.samples >= 40) {
          calibrator.baseline /= calibrator.samples;
          calibrator.done = true;
          setSensorMsg("Tracking phone motion...");
        }
        return;
      }
      const delta = magnitude - calibrator.baseline;
      const stepState = stepStateRef.current;
      const now = event.timeStamp ? event.timeStamp : performance.now();
      const activationThreshold = 0.35;
      const releaseThreshold = 0.15;
      const minStepMs = 250;
      if (!stepState.active && delta > activationThreshold && now - stepState.lastStepTs > minStepMs) {
        stepState.active = true;
        stepState.lastStepTs = now;
        applyStep();
      } else if (stepState.active && delta < releaseThreshold) {
        stepState.active = false;
      }
    };

    lastMotionTsRef.current = null;
    window.addEventListener('deviceorientationabsolute', updateHeading);
    window.addEventListener('deviceorientation', updateHeading);
    window.addEventListener('devicemotion', handleMotion);
    return () => {
      window.removeEventListener('deviceorientationabsolute', updateHeading);
      window.removeEventListener('deviceorientation', updateHeading);
      window.removeEventListener('devicemotion', handleMotion);
      lastMotionTsRef.current = null;
      calibrationRef.current = { baseline: 0, samples: 0, done: false };
      stepStateRef.current = { lastStepTs: 0, active: false };
    };
  }, [sensorTracking, selUrl, snapToWalkable, floor]);

  // Helpers similar to editor for routing
  const normHex = (s) => {
    if (!s) return '#000000';
    let t = s.toString().trim().toUpperCase();
    if (!t.startsWith('#')) t = '#' + t;
    if (t.length === 4) t = '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    return /^#[0-9A-F]{6}$/.test(t) ? t : '#000000';
  };
  const hexToRgb = (hex) => {
    const h = normHex(hex); return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  };
  const buildGrid = async (imgEl, color, tol, step=4) => {
    const w = imgEl.naturalWidth||imgEl.width, h = imgEl.naturalHeight||imgEl.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx=c.getContext('2d');
    ctx.drawImage(imgEl,0,0,w,h); const id=ctx.getImageData(0,0,w,h); const data=id.data;
    const [tr,tg,tb] = hexToRgb(color||'#9F9383'); const gw=Math.max(1,Math.floor(w/step)), gh=Math.max(1,Math.floor(h/step));
    const grid=new Uint8Array(gw*gh); const tolv=Math.max(0,Math.min(255, tol||0));
    for(let gy=0;gy<gh;gy++){ for(let gx=0;gx<gw;gx++){ const px=Math.min(w-1,gx*step+(step>>1)); const py=Math.min(h-1,gy*step+(step>>1)); const idx=(py*w+px)*4; const r=data[idx],g=data[idx+1],b=data[idx+2]; const dr=r-tr,dg=g-tg,db=b-tb; const dist=Math.sqrt(dr*dr+dg*dg+db*db); grid[gy*gw+gx]=dist<=tolv?1:0; } }
    return {grid,gw,gh,step,w,h};
  };
  const nearestWalkable = (grid,gw,gh,sx,sy) => {
    const inb=(x,y)=>x>=0&&y>=0&&x<gw&&y<gh; const q=[[sx,sy]]; const seen=new Set([sy*gw+sx]);
    if (grid[sy*gw+sx]) return [sx,sy];
    const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    while(q.length){const [x,y]=q.shift(); for(const [dx,dy] of dirs){const nx=x+dx,ny=y+dy; const k=ny*gw+nx; if(!inb(nx,ny)||seen.has(k)) continue; seen.add(k); if(grid[k]) return [nx,ny]; q.push([nx,ny]);}}
    return null;
  };
  const bfs = (grid,gw,gh,s,t,gap=0) => {
    const inb=(x,y)=>x>=0&&y>=0&&x<gw&&y<gh; const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    const prev=new Int32Array(gw*gh).fill(-1); const seen=new Uint8Array(gw*gh); const q=[]; const sIdx=s[1]*gw+s[0], tIdx=t[1]*gw+t[0]; q.push(sIdx); seen[sIdx]=1;
    while(q.length){ const cur=q.shift(); if(cur===tIdx) break; const cx=cur%gw, cy=(cur/gw)|0; for(const [dx,dy] of dirs){ let nx=cx+dx, ny=cy+dy; if(!inb(nx,ny)) continue; let tgt=-1; const nIdx=ny*gw+nx; if(grid[nIdx]) tgt=nIdx; else if(gap>0){ for(let k=2;k<=gap+1;k++){const nx2=cx+dx*k, ny2=cy+dy*k; if(!inb(nx2,ny2)) break; const idx2=ny2*gw+nx2; if(grid[idx2]){ tgt=idx2; break; } } } if(tgt===-1) continue; if(seen[tgt]) continue; seen[tgt]=1; prev[tgt]=cur; q.push(tgt);} }
    if (prev[tIdx]===-1 && sIdx!==tIdx) return null; const out=[]; for(let cur=tIdx;cur!==-1;cur=prev[cur]){ const x=cur%gw, y=(cur/gw)|0; out.push([x,y]); if(cur===sIdx) break; } out.reverse(); return out;
  };

  // Build a cross-floor plan from current floor to destination floor using shared warp keys
  const sharedWarpKeys = (a, b) => {
    const A=new Set(), B=new Set();
    (a?.points||[]).forEach(p=>{ if(p?.kind==='poi' && (p.poiType==='stairs'||p.poiType==='elevator') && p.warpKey) A.add(p.warpKey.trim()); });
    (b?.points||[]).forEach(p=>{ if(p?.kind==='poi' && (p.poiType==='stairs'||p.poiType==='elevator') && p.warpKey) B.add(p.warpKey.trim()); });
    const out=[]; for(const k of A) if(B.has(k)) out.push(k); return out;
  };
  const makePlan = (fromUrl, toUrl) => {
    if (!fromUrl || !toUrl || fromUrl===toUrl) return [{ url: fromUrl, kind:'dest' }];
    const urls = floors.map(f=>f.url);
    const prev=new Map([[fromUrl,null]]); const q=[fromUrl];
    const keysByUrl=new Map(floors.map(f=>[f.url, new Set((f.points||[]).filter(p=>p?.warpKey && (p.poiType==='stairs'||p.poiType==='elevator')).map(p=>p.warpKey.trim()))]));
    while(q.length){ const u=q.shift(); if(u===toUrl) break; for(const v of urls){ if(prev.has(v)||v===u) continue; const A=keysByUrl.get(u)||new Set(); const B=keysByUrl.get(v)||new Set(); let ok=false; for(const k of A){ if(B.has(k)){ok=true;break;} } if(ok){ prev.set(v,u); q.push(v);} } }
    if (!prev.has(toUrl)) return [{ url: fromUrl, kind:'dest' }];
    const chain=[]; for(let at=toUrl; at; at=prev.get(at)) chain.push(at); chain.reverse();
    return chain.map((u,i)=>({ url:u, kind: i===chain.length-1? 'dest':'warp' }));
  };

  const computeRouteForStep = async (step) => {
    const curFloor = floors.find(f=>f.url===selUrl); if (!curFloor) return;
    const img = imgRef.current; if (!img || !img.naturalWidth) return;
    const gridObj = await buildGrid(img, curFloor.walkable?.color, curFloor.walkable?.tolerance, 4);
    const {grid,gw,gh,step:stp,w,h}=gridObj;
    const ux = Math.max(0, Math.min(gw-1, Math.round((userPos.x*w)/stp)));
    const uy = Math.max(0, Math.min(gh-1, Math.round((userPos.y*h)/stp)));
    const sCell = nearestWalkable(grid,gw,gh,ux,uy); if (!sCell) { setRoutePts([]); return; }
    let target = null;
    if (step.kind==='dest') {
      const destFloor = floors.find(f=> f.points?.some(p=> p.id===dest?.id));
      const dp = destFloor && destFloor.url===selUrl ? destFloor.points.find(p=>p.id===dest.id) : null;
      if (!dp) { setRoutePts([]); return; }
      target = { x: dp.x, y: dp.y };
    } else {
      // step.kind==='warp': pick nearest shared warp to user among keys shared with next floor
      const nextUrl = (plan && plan.steps[plan.index+1]) ? plan.steps[plan.index+1].url : null;
      const shared = sharedWarpKeys(curFloor, floors.find(f=>f.url===nextUrl)||{});
      let best=null, bestD=Infinity; for(const p of (curFloor.points||[])){
        if (p?.kind==='poi' && (p.poiType==='stairs'||p.poiType==='elevator') && p.warpKey && shared.includes(p.warpKey.trim())){
          const d=Math.hypot((p.x-userPos.x),(p.y-userPos.y)); if(d<bestD){bestD=d; best=p;}
        }
      }
      if (!best) { setRoutePts([]); return; }
      target = { x: best.x, y: best.y };
      // Store current warp target on step for proximity check
      step.key = best.warpKey.trim(); step.target = target;
    }
    const tx=Math.max(0,Math.min(gw-1,Math.round((target.x*w)/stp))); const ty=Math.max(0,Math.min(gh-1,Math.round((target.y*h)/stp)));
    const tCell = nearestWalkable(grid,gw,gh,tx,ty); if (!tCell) { setRoutePts([]); return; }
    const path = bfs(grid,gw,gh,sCell,tCell, Math.max(0,Math.floor(gapCells)));
    if (!path || path.length<2) { setRoutePts([]); return; }
    const out = path.map(([gx,gy])=> ({ x: ((gx*stp)+(stp/2))/w, y: ((gy*stp)+(stp/2))/h }));
    setRoutePts(out);
  };

  const startRoute = async () => {
    if (!floor || !userPos || !dest) return;
    const destFloor = floors.find(f=> f.points?.some(p=> p.id===dest.id)); if(!destFloor) return;
    const steps = makePlan(selUrl, destFloor.url);
    const planObj = { steps, index: 0 };
    setPlan(planObj);
    await computeRouteForStep(planObj.steps[0]);
  };

  const clearRoute = () => { setRoutePts([]); setPlan(null); };

  // Auto-warp when near target warp
  useEffect(() => {
    if (!autoWarp) return;
    if (!plan || !plan.steps || plan.index>=plan.steps.length) return;
    const step = plan.steps[plan.index]; if (step.kind!=='warp' || !step.target) return;
    if (!userPos) return;
    const d = Math.hypot((userPos.x - step.target.x), (userPos.y - step.target.y));
    if (d <= warpProximity) {
      // Switch to next floor and place user at matching warp
      const next = plan.steps[plan.index+1]; if (!next) return;
      const curFloor = floors.find(f=>f.url===selUrl); const nextFloor = floors.find(f=>f.url===next.url);
      const match = (nextFloor?.points||[]).find(p=> p?.kind==='poi' && (p.poiType==='stairs'||p.poiType==='elevator') && p.warpKey && p.warpKey.trim()===step.key);
      if (match) {
        saveUserPos(nextFloor.url, { x: match.x, y: match.y });
        setSelUrl(nextFloor.url);
        setPlan(p=> p? ({ ...p, index: p.index+1 }):p);
        setRoutePts([]);
      }
    }
  }, [autoWarp, userPos, plan, floors, selUrl, warpProximity]);

  // Recompute route when floor switches within an active plan
  useEffect(() => {
    (async () => {
      if (!plan || !plan.steps || plan.index>=plan.steps.length) return;
      const step = plan.steps[plan.index]; if (step.url !== selUrl) return;
      if (!userPos) return;
      await computeRouteForStep(step);
    })();
  }, [selUrl, plan, userPos, gapCells]);

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h5 className="card-title text-dark m-0">Public Map</h5>
        <div className="d-flex align-items-center gap-2">
          <select className="form-select form-select-sm" value={selUrl} onChange={(e)=> setSelUrl(e.target.value)}>
            {floors.map(f => <option key={f.url} value={f.url}>{f.name || 'floor'}</option>)}
          </select>
          <button className={`btn btn-sm ${placing? 'btn-warning':'btn-outline-warning'}`} onClick={()=> setPlacing(p=>!p)}>
            {placing ? "Click map: I'm here" : "I'm here"}
          </button>
          <button
            className={`btn btn-sm ${sensorTracking ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => sensorTracking ? stopSensorTracking() : startSensorTracking()}
            title="Use phone sensors (motion + compass) to move the marker"
          >
            {sensorTracking ? "Stop tracking" : "Use phone sensors"}
          </button>
          <input className="form-control form-control-sm" placeholder="Search room (e.g., B500)" value={searchText} onChange={(e)=> setSearchText(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') searchRoom(); }} style={{ maxWidth: 180 }} />
          <button className="btn btn-sm btn-outline-primary" onClick={searchRoom}>Search</button>
        </div>
        </div>
        {floor && (
          <div className="position-relative" ref={scrollRef} style={{ overflow: 'auto', maxHeight: 600, borderRadius: 10 }}>
            <div ref={spacerRef} className="position-relative" style={{ width: natSize.w, height: natSize.h }}>
              <div
                ref={contentRef}
                className="position-absolute"
                style={{ left: 0, top: 0, width: natSize.w, height: natSize.h, cursor: placing? 'crosshair':'default' }}
                onClick={(e)=>{ if(!placing) return; const raw = toNorm(e.clientX, e.clientY); const p = snapToWalkable(raw.x, raw.y); setUserPos(p); saveUserPos(selUrl, p); setPlacing(false); }}
              >
                <style>{`@keyframes routeDash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }`}</style>
                <img ref={imgRef} src={floor.url} alt={floor.name||'floor'} onLoad={onImgLoad} style={{ width: '100%', height: '100%', display:'block', userSelect:'none', pointerEvents:'none' }} />

                {userPos && (()=>{ const pos = toPx(userPos.x, userPos.y); const size=18; return (
                  <div key="user" className="position-absolute rounded-circle" style={{ left: pos.x-size/2, top: pos.y-size/2, width:size, height:size, background:'#ff3366', border:'3px solid #fff', boxShadow:'0 0 0 4px rgba(255,51,102,0.35)', zIndex: 5 }} title="You" />
                );})()}

                {(Array.isArray(floor.points)?floor.points:[]).map(p=>{ const pos=toPx(p.x,p.y); const size=8; const isDest = dest && dest.id===p.id; return (
                  <div key={p.id}
                    className={`position-absolute rounded-circle ${markerClass(p.kind)} ${isDest?'border border-light':''}`}
                    style={{ left: pos.x-size/2, top: pos.y-size/2, width:size, height:size, cursor:'pointer' }}
                    title={(p.roomNumber?`#${p.roomNumber} `:'') + (p.name||p.poiType||p.kind)}
                    onClick={()=> setDest({ url: selUrl, id: p.id })}
                  />
                );})}

                {routePts && routePts.length>1 && (
                  <svg className="position-absolute" width={natSize.w} height={natSize.h} style={{ left:0, top:0, pointerEvents:'none' }}>
                    <polyline points={routePts.map(p=>`${p.x*natSize.w},${p.y*natSize.h}`).join(' ')} fill="none" stroke="#00D1FF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 10" style={{ animation:'routeDash 1.5s linear infinite' }} />
                    <polyline points={routePts.map(p=>`${p.x*natSize.w},${p.y*natSize.h}`).join(' ')} fill="none" stroke="rgba(0,209,255,0.35)" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="12 14" style={{ filter:'blur(1px)', animation:'routeDash 1.5s linear infinite' }} />
                  </svg>
                )}
              </div>
            </div>
          </div>
        )}
        {!floor && (
          <div className="text-muted">No published floors available yet.</div>
        )}
        <div className="d-flex align-items-center gap-2 mt-2">
          <button className="btn btn-primary btn-sm" onClick={startRoute} disabled={!userPos || !dest}>Route</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={clearRoute} disabled={!routePts.length}>Clear</button>
          <div className="d-flex align-items-center small text-muted" style={{ gap: 8 }}>
            <span>Gap</span>
            <input type="range" min="0" max="5" step="1" value={gapCells} onChange={(e)=> setGapCells(parseInt(e.target.value)||0)} style={{ width: 80 }} />
            <span>{gapCells}</span>
          </div>
          <button className={`btn btn-${autoWarp?'info':'outline-info'} btn-sm`} onClick={()=> setAutoWarp(v=>!v)}>Auto warp: {autoWarp?'On':'Off'}</button>
          <div className="d-flex align-items-center small text-muted" style={{ gap: 8 }}>
            <span>Step</span>
            <input type="range" min="0.002" max="0.03" step="0.001" value={moveStep} onChange={(e)=> setMoveStep(parseFloat(e.target.value)||0.01)} style={{ width: 120 }} />
            <span>{moveStep.toFixed(3)}</span>
          </div>
          {searchMsg && <span className="small text-muted">{searchMsg}</span>}
        </div>
        {sensorMsg && <div className="small text-muted mt-2">{sensorMsg}</div>}
      </div>
    </div>
  );
}

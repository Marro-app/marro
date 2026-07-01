import React from 'react';
const { useState, useEffect, useCallback } = React;

export const useLiftCard = (open, ref) => {
  useEffect(()=>{
    if(!open || !ref.current) return;
    const card = ref.current.closest(".mc,.mm");
    if(!card) return;
    const prev = card.style.zIndex;
    card.style.zIndex = 50;
    return ()=>{ card.style.zIndex = prev; };
  },[open]);
};
// Keyboard dismissal for popovers — backdrop scrims are pointer-only, so Esc is the
// keyboard path to close without selecting (WCAG 2.1.1). Mirrors the Modal's Esc handler.
export const useEscClose = (open, close) => {
  useEffect(()=>{
    if(!open) return;
    const onKey = e => { if(e.key==="Escape"){ e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey);
    return ()=> document.removeEventListener("keydown", onKey);
  },[open]);
};

// Period dropdown for comparisons — pick a full year or a single month within it
export const useEdgeFade = (ref, deps=[]) => {
  const [fade, setFade] = React.useState({l:false, r:false});
  const check = React.useCallback(()=>{
    const el = ref.current; if(!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setFade({l: el.scrollLeft > 1, r: el.scrollLeft < max - 1});
  },[ref]);
  useEffect(()=>{
    check();
    const el = ref.current; if(!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, {passive:true});
    return ()=>{ ro.disconnect(); el.removeEventListener("scroll", check); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[check, ...deps]);
  return fade;
};

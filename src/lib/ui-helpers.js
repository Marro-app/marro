import { createPortal } from 'react-dom';
import { C } from './theme.js';

export const popoverStyle = (width, align="left") => ({position:"absolute",top:"calc(100% + 4px)",[align==="right"?"right":"left"]:0,background:C.glassTooltip,backdropFilter:"blur(50px) saturate(200%)",WebkitBackdropFilter:"blur(50px) saturate(200%)",border:`1px solid ${C.borderDark}`,borderRadius:12,padding:12,zIndex:100,width,boxShadow:"0 8px 32px rgba(0,0,0,0.40)"});
export const wrapPop = (fixedPos, node) => fixedPos ? createPortal(node, document.body) : node;
export const edgeFadeClass = fade => [fade.l&&"fade-l", fade.r&&"fade-r"].filter(Boolean).join(" ");
export const radioProps = active => ({role:"radio","aria-checked":active?"true":"false", tabIndex:active?0:-1});
export const tabProps = (active, id, panelId) => ({role:"tab","aria-selected":active?"true":"false", tabIndex:active?0:-1, id, "aria-controls":panelId});
export const yrRangeLabel = (yr) => yr && yr.startDate
  ? `${new Date(yr.startDate+"T12:00:00").toLocaleDateString("en-US",{month:"short"})} ’${new Date(yr.startDate+"T12:00:00").toLocaleDateString("en-US",{year:"2-digit"})} – ${new Date(yr.endDate+"T12:00:00").toLocaleDateString("en-US",{month:"short"})} ’${new Date(yr.endDate+"T12:00:00").toLocaleDateString("en-US",{year:"2-digit"})}`
  : "";

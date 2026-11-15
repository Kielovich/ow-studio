/** Browser-storage key of a dismissed tip (see components/help.tsx). */
export const TIP_KEY_PREFIX = "ow-tip-dismissed:";
/** The style element that hides dismissed tips before the first paint. */
export const TIPS_OFF_STYLE_ID = "ow-tips-off";

/**
 * Runs at the top of <body>, before anything is painted: one CSS rule per dismissed tip. Without storage it does
 * nothing and the tips simply show.
 */
export const TIPS_OFF_SCRIPT = `try{var s="";for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);` +
  `if(k&&k.indexOf("${TIP_KEY_PREFIX}")===0&&localStorage.getItem(k)==="1"){` +
  `s+='[data-tip="'+k.slice(${TIP_KEY_PREFIX.length}).replace(/[^a-z0-9-]/gi,"")+'"]{display:none!important}'}}` +
  `if(s){var e=document.createElement("style");e.id="${TIPS_OFF_STYLE_ID}";e.textContent=s;document.head.appendChild(e)}}catch(e){}`;

export const CSS = `
*{box-sizing:border-box}
.fb-host{position:fixed;inset:0;z-index:2147483000;pointer-events:none;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#0f172a;--accent:#0e9f6e}

.fb-overlay{position:absolute;inset:0;pointer-events:none}
.fb-highlight{position:fixed;border:2px solid var(--accent);border-radius:6px;background:rgba(14,159,110,.08);pointer-events:none;display:none;z-index:1}
.fb-spotlight{position:fixed;border:2px solid var(--accent);border-radius:8px;pointer-events:none;display:none;z-index:2;box-shadow:0 0 0 100vmax rgba(15,23,42,.5),0 0 14px 1px rgba(14,159,110,.55)}
.fb-pin{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;background:var(--accent);color:#fff;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(14,159,110,.5);pointer-events:none;z-index:2;animation:fb-pindrop .18s cubic-bezier(.23,1,.32,1)}
/* The pin drop is the tool's core "your click became feedback" confirmation. */
@keyframes fb-pindrop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}

.fb-widget{position:fixed;z-index:5;pointer-events:auto}
.fb-widget.pos-br{right:22px;bottom:22px}
.fb-widget.pos-bl{left:22px;bottom:22px}
.fb-bubble{position:relative;width:56px;height:56px;border-radius:50%;cursor:pointer;background:rgba(15,23,42,.72);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 10px 30px rgba(15,23,42,.35);transition:transform .15s}
.fb-bubble:hover{transform:translateY(-2px)}
.fb-bubble.has-review::after{content:'';position:absolute;top:-1px;right:-1px;width:13px;height:13px;border-radius:50%;background:var(--accent);border:2px solid #fff;box-shadow:0 1px 3px rgba(15,23,42,.4)}
.fb-bubble.starting{cursor:default}
.fb-bubble svg{width:24px;height:24px}
.fb-spinner{width:22px;height:22px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:fb-spin .8s linear infinite}
@keyframes fb-spin{to{transform:rotate(360deg)}}
/* Recording HUD — a draggable pill; positioned via inline left/top (or default corner). */
.fb-pill{position:fixed;z-index:5;display:none;align-items:center;gap:8px;background:rgba(15,23,42,.85);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:999px;padding:6px 10px 6px 4px;box-shadow:0 14px 40px rgba(15,23,42,.4);pointer-events:auto}
.fb-pill.dragging{box-shadow:0 22px 60px rgba(15,23,42,.55)}
/* six-dot drag grip on the left */
.fb-hgrip{display:flex;align-items:center;justify-content:center;width:22px;height:30px;border:0;background:transparent;border-radius:8px;color:rgba(255,255,255,.5);cursor:grab;flex:0 0 auto;padding:0}
.fb-hgrip:hover{color:rgba(255,255,255,.9);background:rgba(255,255,255,.08)}
.fb-hgrip:active{cursor:grabbing}
.fb-hgrip svg{width:12px;height:18px}
/* Custom HUD tooltip — instant, styled (native title is slow and feels broken here). */
.fb-tip{position:fixed;z-index:9;pointer-events:none;background:rgba(15,23,42,.96);color:#fff;font-size:11.5px;font-weight:500;line-height:1.3;padding:5px 9px;border-radius:7px;box-shadow:0 6px 20px rgba(15,23,42,.4);white-space:nowrap;max-width:260px;opacity:0;transform:translateY(3px);transition:opacity .12s ease,transform .12s ease}
.fb-tip.show{opacity:1;transform:none}
/* voice/text sliding switch (icons only; tooltips on hover) — far left of the HUD */
.fb-mswitch{position:relative;display:inline-flex;align-items:center;background:rgba(255,255,255,.10);border-radius:999px;padding:3px;flex:0 0 auto}
.fb-mknob{position:absolute;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .2s cubic-bezier(.3,.8,.3,1)}
.fb-mswitch.text .fb-mknob{transform:translateX(100%)}
.fb-mopt{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:30px;height:26px;border:0;background:transparent;color:rgba(255,255,255,.6);cursor:pointer;padding:0;border-radius:999px;transition:color .18s}
.fb-mopt svg{width:15px;height:15px}
.fb-mswitch:not(.text) .fb-mopt-v{color:#0f172a}
.fb-mswitch.text .fb-mopt-t{color:#0369a1}
.fb-mopt:hover{color:#fff}
.fb-mswitch:not(.text) .fb-mopt-v:hover{color:#0f172a}
.fb-mswitch.text .fb-mopt-t:hover{color:#0369a1}
.fb-dot{width:10px;height:10px;border-radius:50%;background:#ff5d5d;transition:background-color .15s ease}
.fb-pill:not(.paused):not(.text):not(.clickonly) .fb-dot{animation:fb-pulse 1.4s infinite}
.fb-pill.paused .fb-dot{background:#f5a623}
/* Text mode: no mic — calm teal dot, a "text" label, and no timer (time isn't meaningful). */
.fb-pill.text .fb-dot{background:#38bdf8;animation:none}
.fb-pill.text .fb-time{display:none}
/* Click-only (mic unavailable): amber, non-pulsing — no audio is being captured. */
.fb-pill.clickonly .fb-dot{background:#f5a623;animation:none}
.fb-pill.clickonly .fb-modelbl{color:#f5a623}
.fb-modelbl{font-size:10.5px;color:#7dd3fc;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
@keyframes fb-pulse{0%{box-shadow:0 0 0 0 rgba(255,93,93,.55)}70%{box-shadow:0 0 0 9px rgba(255,93,93,0)}100%{box-shadow:0 0 0 0 rgba(255,93,93,0)}}
.fb-time{font-variant-numeric:tabular-nums;font-weight:600;font-size:14px}
.fb-pstate{font-size:10.5px;color:#f5a623;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
/* Middot separates the status labels (e.g. "TEXT · PAUSED") so they don't crowd. */
.fb-pstate:not(:empty)::before{content:'\\00b7';margin:0 7px 0 1px;color:rgba(255,255,255,.4);font-weight:400}
.fb-pctl{display:inline-flex;align-items:center;gap:5px;background:transparent;border:0;color:#fff;font:inherit;font-size:12px;cursor:pointer;padding:5px 8px;border-radius:999px}
.fb-pctl:hover{background:rgba(255,255,255,.14)}
.fb-pctl svg{width:14px;height:14px}
.fb-clear{color:rgba(255,255,255,.6)}
.fb-clear:hover{background:rgba(239,68,68,.22);color:#fecaca}
.fb-vsep{width:1px;align-self:stretch;background:rgba(255,255,255,.18);margin:3px 0}

/* "Clear this transcript?" confirmation modal. */
.fb-confirm{position:fixed;inset:0;z-index:8;display:none;align-items:center;justify-content:center;pointer-events:none}
.fb-confirm.open{display:flex}
.fb-confirm-back{position:absolute;inset:0;background:rgba(15,23,42,.5);pointer-events:auto;cursor:auto}
.fb-confirm-box{position:relative;pointer-events:auto;cursor:auto;width:340px;max-width:calc(100vw - 32px);background:#fff;color:#0f172a;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.45);padding:20px 22px;text-align:left}
.fb-confirm-title{font-size:16px;font-weight:700;margin-bottom:6px}
.fb-confirm-msg{font-size:13px;color:#64748b;line-height:1.5;margin-bottom:18px}
.fb-confirm-row{display:flex;justify-content:flex-end;gap:10px}
.fb-confirm-cancel{border:1px solid #e2e8f0;background:#fff;color:#0f172a;font:inherit;font-size:13px;font-weight:600;border-radius:9px;padding:9px 15px;cursor:pointer}
.fb-confirm-cancel:hover{background:#f1f5f9}
.fb-confirm-ok{border:0;background:#ef4444;color:#fff;font:inherit;font-size:13px;font-weight:650;border-radius:9px;padding:9px 15px;cursor:pointer}
.fb-confirm-ok:hover{background:#dc2626}
/* Destructive prompt shouldn't pop in — fade the scrim, ease the box up. */
.fb-confirm.open .fb-confirm-back{animation:fb-fade-in .18s ease}
.fb-confirm.open .fb-confirm-box{animation:fb-modal-in .2s cubic-bezier(.23,1,.32,1)}
@keyframes fb-fade-in{from{opacity:0}to{opacity:1}}
@keyframes fb-modal-in{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:none}}

/* Text-mode composer: react-grab-style note box anchored to the clicked element. */
.fb-composer{position:fixed;z-index:6;width:260px;max-width:calc(100vw - 24px);background:#fff;color:#0f172a;border:1px solid #e5e8ee;border-radius:14px;box-shadow:0 16px 40px rgba(15,23,42,.22);pointer-events:auto;cursor:auto;display:none;overflow:hidden;transform-origin:left center;animation:fb-pop .16s ease-out}
@keyframes fb-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.fb-chead{display:flex;align-items:center;gap:7px;padding:9px 11px;border-bottom:1px solid #eef2f6}
.fb-cbadge{width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.fb-cbadge svg{width:11px;height:11px}
.fb-csrc{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#065f46;background:#effaf4;border-radius:5px;padding:2px 6px;word-break:break-all}
.fb-ctext{width:100%;border:0;resize:none;padding:10px 11px;font:inherit;font-size:12.5px;line-height:1.5;outline:none;min-height:56px;color:#0f172a}
.fb-cfoot{display:flex;justify-content:flex-end;gap:8px;padding:8px 10px;border-top:1px solid #eef2f6}
.fb-ccancel{border:0;background:transparent;color:#94a3b8;font-size:12px;cursor:pointer;padding:7px 10px;border-radius:8px}
.fb-ccancel:hover{color:#0f172a}
.fb-cadd{border:0;background:var(--accent);color:#fff;font-weight:650;font-size:12px;border-radius:8px;padding:7px 13px;cursor:pointer}
.fb-cadd:hover{filter:brightness(1.05)}
.fb-cadd:disabled{opacity:.5;cursor:default;filter:none}

.fb-caption{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:4;max-width:min(680px,90vw);background:rgba(15,23,42,.86);backdrop-filter:blur(12px);color:#fff;border-radius:12px;padding:12px 16px;box-shadow:0 12px 34px rgba(15,23,42,.4);font-size:15px;line-height:1.5;pointer-events:none;display:none}
.fb-caption .lbl{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;opacity:.55;margin-bottom:3px}
.fb-notice{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:4;background:rgba(15,23,42,.7);color:#fff;padding:8px 14px;border-radius:999px;font-size:12.5px;pointer-events:none;display:none}

.fb-sheet{position:fixed;top:0;right:0;height:100%;width:380px;max-width:92vw;z-index:6;background:#fff;border-left:1px solid #e5e8ee;box-shadow:-16px 0 40px rgba(15,23,42,.14);transform:translateX(102%);transition:transform .28s cubic-bezier(.2,.7,.2,1),opacity .18s ease;display:flex;flex-direction:column;pointer-events:auto}
.fb-sheet.open{transform:none}
.fb-sheet.dim{opacity:.28;pointer-events:none}
/* Yields to the app: fades + click-through while the cursor is over the app. */
.fb-sheet.yield{opacity:.14;pointer-events:none}
.fb-shead{padding:16px 18px;border-bottom:1px solid #e5e8ee;display:flex;align-items:center;justify-content:space-between;gap:8px}
.fb-shead h2{margin:0;font-size:16px}
.fb-sclose{border:0;background:transparent;color:#94a3b8;font-size:16px;line-height:1;cursor:pointer;padding:4px;flex:0 0 auto}
.fb-sclose:hover{color:#0f172a}
.fb-slist{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.fb-empty{color:#94a3b8;font-size:12.5px;padding:2px}
.fb-card{border:1px solid #e5e8ee;border-radius:12px;padding:10px 12px 10px 24px;position:relative;background:#fff}
.fb-card-speech{background:#fff}
.fb-card-action{background:#f8fafc}
.fb-card.dragging{opacity:.5;border-style:dashed;border-color:var(--accent)}
.fb-grip{position:absolute;left:0;top:0;bottom:0;width:20px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;cursor:grab;font-size:13px;line-height:1;user-select:none}
.fb-grip:hover{color:#94a3b8}
.fb-grip:active{cursor:grabbing}
.fb-card .top{display:flex;align-items:center;gap:8px}
.fb-ctime{font-variant-numeric:tabular-nums;font-size:11px;color:#94a3b8;flex:0 0 auto}
.fb-say{font-size:13.5px;line-height:1.55;color:#0f172a;margin-top:4px;outline:none;border-radius:6px;padding:3px 6px;margin-left:-6px;white-space:pre-wrap;word-break:break-word}
.fb-say:hover{background:#f8fafc}
.fb-say:focus{background:#f1f5f9;box-shadow:0 0 0 2px rgba(14,159,110,.28)}
.fb-say:empty::before{content:"(empty, will be dropped)";color:#cbd5e1}
.fb-badge{width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.fb-comp{font-weight:650;font-size:13.5px}
.fb-src{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#065f46;background:#effaf4;border-radius:6px;padding:2px 6px;display:inline-block;margin-top:6px;word-break:break-all}
.fb-said{font-size:13px;color:#334155;line-height:1.5;margin-top:6px}
/* Element's own text — muted metadata, visually distinct from a speech/note quote. */
.fb-eltext{font-size:11.5px;color:#94a3b8;font-style:italic;line-height:1.45;margin-top:5px}
.fb-del{position:absolute;top:9px;right:9px;border:0;background:transparent;color:#cbd5e1;cursor:pointer;font-size:14px;line-height:1;padding:2px}
.fb-del:hover{color:#ef4444}
.fb-edit{position:absolute;top:9px;right:30px;border:0;background:transparent;color:#cbd5e1;cursor:pointer;font-size:13px;line-height:1;padding:2px}
.fb-edit:hover{color:var(--accent)}
.fb-sfoot{padding:14px;border-top:1px solid #e5e8ee;display:flex;flex-direction:column;gap:10px}
.fb-copy{height:42px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:650;font-size:14px;cursor:pointer}
.fb-copy:hover{filter:brightness(1.05)}
.fb-copy.done{background:#334155;animation:fb-copy-pop .32s ease}
@keyframes fb-copy-pop{0%{transform:scale(1)}40%{transform:scale(1.04)}100%{transform:scale(1)}}
.fb-sfoot-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.fb-resume{background:#eef2f7;border:1px solid #e2e8f0;color:#0f172a;font-size:12.5px;font-weight:600;border-radius:8px;padding:8px 12px;cursor:pointer}
.fb-resume:hover{background:#e2e8f0}
.fb-discard{background:none;border:0;color:#94a3b8;font-size:12px;cursor:pointer;text-decoration:underline}
.fb-fallback{display:none;width:100%;height:120px;font-family:ui-monospace,Menlo,monospace;font-size:11px;border:1px solid #e5e8ee;border-radius:8px;padding:8px}

.fb-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(20px);z-index:7;background:#0f172a;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 14px 40px rgba(15,23,42,.45);font-size:13.5px;display:flex;gap:9px;align-items:center;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.fb-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.fb-toast .ok{color:#34d399;font-weight:700}

/* Respect reduced-motion: drop entrance scale/pop and the pulse; keep transforms
   that define layout state (panel hide, toast centering, switch knob) intact. */
@media (prefers-reduced-motion: reduce){
  .fb-pin,.fb-composer,.fb-copy.done,
  .fb-confirm.open .fb-confirm-box,.fb-confirm.open .fb-confirm-back{animation:none!important}
  .fb-pill .fb-dot{animation:none!important}
  .fb-bubble:hover{transform:none}
}
`

export const CSS = `
*{box-sizing:border-box}
.fb-host{position:fixed;inset:0;z-index:2147483000;pointer-events:none;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#0f172a;--accent:#0e9f6e}

.fb-overlay{position:absolute;inset:0;pointer-events:none}
.fb-highlight{position:fixed;border:2px solid var(--accent);border-radius:6px;background:rgba(14,159,110,.08);pointer-events:none;display:none;z-index:1}
.fb-spotlight{position:fixed;border:2px solid var(--accent);border-radius:8px;pointer-events:none;display:none;z-index:2;box-shadow:0 0 0 100vmax rgba(15,23,42,.5),0 0 14px 1px rgba(14,159,110,.55)}
.fb-pin{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;background:var(--accent);color:#fff;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(14,159,110,.5);pointer-events:none;z-index:2}

.fb-widget{position:fixed;z-index:5;pointer-events:auto}
.fb-widget.pos-br{right:22px;bottom:22px}
.fb-widget.pos-bl{left:22px;bottom:22px}
.fb-bubble{width:56px;height:56px;border-radius:50%;cursor:pointer;background:rgba(15,23,42,.72);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 10px 30px rgba(15,23,42,.35);transition:transform .15s}
.fb-bubble:hover{transform:translateY(-2px)}
.fb-bubble.starting{cursor:default}
.fb-bubble svg{width:24px;height:24px}
.fb-spinner{width:22px;height:22px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:fb-spin .8s linear infinite}
@keyframes fb-spin{to{transform:rotate(360deg)}}
.fb-pill{display:none;align-items:center;gap:12px;cursor:pointer;background:rgba(15,23,42,.82);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:999px;padding:10px 16px 10px 14px;box-shadow:0 10px 30px rgba(15,23,42,.35)}
.fb-dot{width:10px;height:10px;border-radius:50%;background:#ff5d5d;animation:fb-pulse 1.4s infinite}
@keyframes fb-pulse{0%{box-shadow:0 0 0 0 rgba(255,93,93,.55)}70%{box-shadow:0 0 0 9px rgba(255,93,93,0)}100%{box-shadow:0 0 0 0 rgba(255,93,93,0)}}
.fb-time{font-variant-numeric:tabular-nums;font-weight:600;font-size:14px}
.fb-endlbl{font-size:12px;opacity:.8;border-left:1px solid rgba(255,255,255,.18);padding-left:12px}

.fb-caption{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:4;max-width:min(680px,90vw);background:rgba(15,23,42,.86);backdrop-filter:blur(12px);color:#fff;border-radius:12px;padding:12px 16px;box-shadow:0 12px 34px rgba(15,23,42,.4);font-size:15px;line-height:1.5;pointer-events:none;display:none}
.fb-caption .lbl{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;opacity:.55;margin-bottom:3px}
.fb-notice{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:4;background:rgba(15,23,42,.7);color:#fff;padding:8px 14px;border-radius:999px;font-size:12.5px;pointer-events:none;display:none}

.fb-sheet{position:fixed;top:0;right:0;height:100%;width:380px;max-width:92vw;z-index:6;background:#fff;border-left:1px solid #e5e8ee;box-shadow:-16px 0 40px rgba(15,23,42,.14);transform:translateX(102%);transition:transform .28s cubic-bezier(.2,.7,.2,1);display:flex;flex-direction:column;pointer-events:auto}
.fb-sheet.open{transform:none}
.fb-sheet.dim{opacity:.28;pointer-events:none}
.fb-shead{padding:18px 18px 12px;border-bottom:1px solid #e5e8ee}
.fb-shead h2{margin:0;font-size:16px}
.fb-shead p{margin:6px 0 0;color:#64748b;font-size:12.5px;line-height:1.4}
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
.fb-say:empty::before{content:"(empty — will be dropped)";color:#cbd5e1}
.fb-badge{width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.fb-comp{font-weight:650;font-size:13.5px}
.fb-src{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#065f46;background:#effaf4;border-radius:6px;padding:2px 6px;display:inline-block;margin-top:6px;word-break:break-all}
.fb-said{font-size:13px;color:#334155;line-height:1.5;margin-top:6px}
.fb-del{position:absolute;top:9px;right:9px;border:0;background:transparent;color:#cbd5e1;cursor:pointer;font-size:14px;line-height:1;padding:2px}
.fb-del:hover{color:#ef4444}
.fb-edit{position:absolute;top:9px;right:30px;border:0;background:transparent;color:#cbd5e1;cursor:pointer;font-size:13px;line-height:1;padding:2px}
.fb-edit:hover{color:var(--accent)}
.fb-sfoot{padding:14px;border-top:1px solid #e5e8ee;display:flex;flex-direction:column;gap:10px}
.fb-copy{height:42px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:650;font-size:14px;cursor:pointer}
.fb-copy:hover{filter:brightness(1.05)}
.fb-copy.done{background:#334155}
.fb-sfoot-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.fb-resume{background:#eef2f7;border:1px solid #e2e8f0;color:#0f172a;font-size:12.5px;font-weight:600;border-radius:8px;padding:8px 12px;cursor:pointer}
.fb-resume:hover{background:#e2e8f0}
.fb-discard{background:none;border:0;color:#94a3b8;font-size:12px;cursor:pointer;text-decoration:underline}
.fb-fallback{display:none;width:100%;height:120px;font-family:ui-monospace,Menlo,monospace;font-size:11px;border:1px solid #e5e8ee;border-radius:8px;padding:8px}

.fb-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(20px);z-index:7;background:#0f172a;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 14px 40px rgba(15,23,42,.45);font-size:13.5px;display:flex;gap:9px;align-items:center;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.fb-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.fb-toast .ok{color:#34d399;font-weight:700}
`

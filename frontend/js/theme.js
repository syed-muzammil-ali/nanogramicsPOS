/* Theme boot runs before the page paints. Preference is local to this device. */
(() => {
 const root=document.documentElement;
 let theme='light';
 try { const saved=localStorage.getItem('pos-theme'); if(saved==='dark'||saved==='light')theme=saved; } catch {}
 root.dataset.theme=theme;
 function sync() {
  document.querySelectorAll('.theme-toggle').forEach(button=>{
   const dark=root.dataset.theme==='dark';
   button.textContent=dark?'☀ Light mode':'☾ Dark mode';
   button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
   button.setAttribute('aria-pressed',String(dark));
  });
 }
 document.addEventListener('DOMContentLoaded',()=>{
  sync();
  document.querySelectorAll('.theme-toggle').forEach(button=>button.addEventListener('click',()=>{
   root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';
   try {localStorage.setItem('pos-theme',root.dataset.theme);} catch {}
   sync();
  }));
  // Legacy modules render inline colors. Normalize those presentation declarations
  // to semantic tokens, including future renders, without changing business data.
  function normalize(node) {
   if(!(node instanceof Element))return;
   const nodes=[node,...node.querySelectorAll('[style]')];
   for(const el of nodes) {
    if(!el.hasAttribute('style'))continue;
    for(const prop of ['color','background','background-color','border-color','border-top-color','border-bottom-color']) {
     const value=el.style.getPropertyValue(prop);
     if(!value || value.includes('var(')||value==='transparent'||value==='none')continue;
     if(/#|rgb|white|black|gradient/i.test(value))el.style.setProperty(prop,prop==='color'?'var(--text)':prop.startsWith('border')?'var(--border)':'var(--panel2)');
    }
   }
  }
  normalize(document.body);
  new MutationObserver(records=>{
   for(const record of records) {
    if(record.type==='attributes')normalize(record.target);
    else record.addedNodes.forEach(normalize);
   }
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
 });
})();
